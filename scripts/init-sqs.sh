#!/usr/bin/env bash
set -e

echo "Initializing SQS FIFO queues on LocalStack..."
LOCALSTACK_ENDPOINT=${LOCALSTACK_ENDPOINT:-http://localhost:4566}
AWS_REGION=${AWS_REGION:-us-east-1}

# Create DLQ FIFO queue
aws --endpoint-url="$LOCALSTACK_ENDPOINT" --region "$AWS_REGION" sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false || true

# Create Main FIFO queue
aws --endpoint-url="$LOCALSTACK_ENDPOINT" --region "$AWS_REGION" sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false || true

echo "SQS FIFO queues created successfully!"
