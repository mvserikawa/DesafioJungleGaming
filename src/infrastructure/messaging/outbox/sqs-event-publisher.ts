import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { OutboxMessage } from '../../../domain/models/outbox-message';
import { EventPublisherPort } from '../../../domain/ports/event-publisher.port';
import { appLogger } from '../../observability/logger.service';

export class SqsEventPublisher implements EventPublisherPort {
  constructor(
    private readonly sqsClient: SQSClient,
    private readonly queueUrl: string,
  ) {}

  public async publish(outboxMessage: OutboxMessage): Promise<void> {
    const payloadStr = JSON.stringify(outboxMessage.payload);

    try {
      await this.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: payloadStr,
          MessageGroupId: outboxMessage.aggregateId,
          MessageDeduplicationId: outboxMessage.id,
        }),
      );

      appLogger.info('Integration event published to SQS', {
        eventId: outboxMessage.id,
        eventType: outboxMessage.eventType,
        aggregateId: outboxMessage.aggregateId,
      });
    } catch (err) {
      appLogger.error('Failed to publish event to SQS', err, {
        eventId: outboxMessage.id,
        eventType: outboxMessage.eventType,
      });
      throw err;
    }
  }
}
