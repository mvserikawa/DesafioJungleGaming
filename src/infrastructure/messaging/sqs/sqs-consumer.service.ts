import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { ProcessWagerTransactionUseCase } from '../../../application/use-cases/process-wager-transaction.use-case';
import { appLogger } from '../../observability/logger.service';
import { metricsService } from '../../observability/metrics.service';

export interface SqsConsumerOptions {
  queueUrl: string;
  dlqUrl: string;
  maxNumberOfMessages?: number;
  visibilityTimeout?: number;
  waitTimeSeconds?: number;
  maxReceiveCount?: number;
  consumerName?: string;
}

export class SqsConsumerService {
  private isRunning = false;
  private isProcessing = false;
  private readonly consumerName: string;
  private readonly maxReceiveCount: number;

  constructor(
    private readonly sqsClient: SQSClient,
    private readonly processUseCase: ProcessWagerTransactionUseCase,
    private readonly options: SqsConsumerOptions,
  ) {
    this.consumerName = options.consumerName ?? 'wager-transactions-consumer';
    this.maxReceiveCount = options.maxReceiveCount ?? 3;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    appLogger.info('SqsConsumerService started', { queueUrl: this.options.queueUrl });
    this.pollLoop();
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    appLogger.info('SqsConsumerService stopping (waiting for current messages to finish)...');
    while (this.isProcessing) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    appLogger.info('SqsConsumerService stopped');
  }

  public async pollOnce(): Promise<number> {
    try {
      const response = await this.sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: this.options.queueUrl,
          MaxNumberOfMessages: this.options.maxNumberOfMessages ?? 5,
          WaitTimeSeconds: this.options.waitTimeSeconds ?? 1,
          VisibilityTimeout: this.options.visibilityTimeout ?? 30,
          AttributeNames: ['ApproximateReceiveCount' as any],
        }),
      );

      const messages = response.Messages ?? [];
      for (const message of messages) {
        await this.handleMessage(message);
      }
      return messages.length;
    } catch (err) {
      appLogger.error('SQS receive error', err);
      return 0;
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      this.isProcessing = true;
      try {
        await this.pollOnce();
      } catch (err) {
        appLogger.error('Unhandled error in SQS poll loop', err);
      } finally {
        this.isProcessing = false;
      }
    }
  }

  public async handleMessage(message: Message): Promise<void> {
    const messageId = message.MessageId || 'unknown';
    const receiveCount = parseInt(
      message.Attributes?.ApproximateReceiveCount ?? '1',
      10,
    );

    let parsedBody: any;
    try {
      parsedBody = JSON.parse(message.Body ?? '{}');
    } catch (parseError) {
      appLogger.error('Invalid JSON message received, routing to DLQ', parseError, {
        messageId,
      });
      await this.routeToDlq(message, 'INVALID_JSON');
      await this.ackMessage(message);
      return;
    }

    const { data, messageId: envelopeMsgId } = parsedBody;
    const effectiveMsgId = envelopeMsgId || messageId;

    if (!data || !data.providerId || !data.externalTransactionId) {
      appLogger.error('Invalid message schema, routing to DLQ', null, {
        messageId: effectiveMsgId,
      });
      await this.routeToDlq(message, 'MALFORMED_DATA');
      await this.ackMessage(message);
      return;
    }

    try {
      const startTime = performance.now();
      const result = await this.processUseCase.execute(
        {
          providerId: data.providerId,
          externalTransactionId: data.externalTransactionId,
          playerId: data.playerId,
          walletId: data.walletId,
          roundId: data.roundId,
          gameId: data.gameId,
          kind: data.kind,
          money: data.money,
          referenceExternalTransactionId: data.referenceExternalTransactionId,
        },
        {
          idempotencyKey: data.idempotencyKey || `${data.providerId}:${data.externalTransactionId}`,
          inboxMessageId: effectiveMsgId,
          consumerName: this.consumerName,
          correlationId: messageId,
        },
      );

      const durationSec = (performance.now() - startTime) / 1000;
      metricsService.processingLatencySeconds.observe(
        { kind: data.kind, status: result.status },
        durationSec,
      );

      if (result.idempotentReplay) {
        metricsService.idempotentReplaysTotal.inc({ provider: data.providerId });
      }

      metricsService.wagerTransactionsTotal.inc({
        status: result.status,
        provider: data.providerId,
        kind: data.kind,
      });

      // Commit confirmed! ACK message
      await this.ackMessage(message);

      appLogger.info('SQS message processed successfully', {
        messageId: effectiveMsgId,
        transactionId: result.transactionId,
        status: result.status,
      });
    } catch (error: any) {
      appLogger.error('Error processing SQS message', error, {
        messageId: effectiveMsgId,
        receiveCount,
      });

      if (receiveCount >= this.maxReceiveCount) {
        // Exceeded retries, route to DLQ and ACK
        await this.routeToDlq(message, error.message || 'EXCEEDED_MAX_RETRIES');
        await this.ackMessage(message);
      } else {
        // Transient error: do not ack, allowing redelivery
        metricsService.retriesTotal.inc({ component: 'sqs_consumer' });
      }
    }
  }

  private async ackMessage(message: Message): Promise<void> {
    if (!message.ReceiptHandle) return;
    try {
      await this.sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: this.options.queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
    } catch (err) {
      appLogger.error('Failed to ACK SQS message', err, {
        messageId: message.MessageId,
      });
    }
  }

  private async routeToDlq(message: Message, reason: string): Promise<void> {
    metricsService.dlqMessagesTotal.inc({ queue: this.options.queueUrl });
    try {
      await this.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: this.options.dlqUrl,
          MessageBody: message.Body,
          MessageGroupId: message.Attributes?.MessageGroupId || 'dlq',
          MessageDeduplicationId: `dlq-${message.MessageId}-${Date.now()}`,
          MessageAttributes: {
            FailureReason: {
              DataType: 'String',
              StringValue: reason,
            },
          },
        }),
      );
      appLogger.warn('Message routed to DLQ', {
        messageId: message.MessageId,
        reason,
      });
    } catch (dlqErr) {
      appLogger.error('Failed to forward message to DLQ', dlqErr, {
        messageId: message.MessageId,
      });
    }
  }
}
