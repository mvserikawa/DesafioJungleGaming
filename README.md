# Distributed Wagering Processor — Jungle Gaming 🦧

Financial distributed wagering transaction processor built with **Bun 1.x**, **TypeScript** (strict mode), **NestJS**, **MikroORM**, **PostgreSQL**, and **AWS SQS** (LocalStack).

---

## 🚀 Features

- **Strict Financial Precision**: Exact fixed 2-decimal scale using `Money` Value Object via `Decimal.js` and PostgreSQL `NUMERIC(18, 2)`. Zero floating-point `number` or `float` types.
- **Persistent Idempotency**: Cryptographic SHA-256 canonical JSON payload hashing with PostgreSQL unique constraints. Distinguishes identical replays from payload conflicts.
- **Pessimistic Row-Level Locking**: Scoped strictly to `walletId` (`SELECT ... FOR UPDATE`), serializing operations on contested wallets without global locks.
- **Immutable Ledger**: Append-only ledger entries guarded by domain rules and physical PostgreSQL database triggers preventing `UPDATE` and `DELETE`.
- **Transactional Outbox & Inbox**: Guarantees atomic writes between wallet balance, ledger entry, inbox deduplication, and integration events using `FOR UPDATE SKIP LOCKED`.
- **Fault-Tolerant SQS FIFO Processing**: At-least-once delivery handling, poison pill routing to Dead Letter Queue (DLQ), and graceful shutdown on `SIGTERM`.
- **Out-of-Order Reference Resolution**: `REFUND` and `ROLLBACK` arriving prior to referenced `BET` are persisted as `PENDING_REFERENCE` and automatically reconciled by a background worker.
- **High Performance**: Achieves **>8,000 ops/sec** throughput with sub-100ms p95 latencies.

---

## 🛠 Tech Stack

| Component | Technology |
|---|---|
| **Runtime & Test Runner** | **Bun 1.x** |
| **Language** | **TypeScript 5.x** (Strict Mode) |
| **Framework** | **NestJS 10.x** |
| **Database** | **PostgreSQL 16** |
| **ORM** | **MikroORM 6.x** (Unit of Work, Identity Map, LockMode) |
| **Messaging** | **AWS SQS FIFO** via LocalStack |
| **Orchestration** | **Docker Compose** (PostgreSQL, LocalStack, 3 App instances) |
| **Observability** | **Pino** (JSON logging) & **Prometheus** (`prom-client`) |

---

## 📋 Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- [Docker](https://www.docker.com/) & Docker Compose

---

## ⚡ Quick Start

### 1. Clone & Install Dependencies

```bash
git clone <repository-url>
cd DesafioJungleGaming
bun install
```

### 2. Start Infrastructure with Docker Compose

To start PostgreSQL, LocalStack (SQS), and 3 concurrent application instances:

```bash
docker compose up -d
```

Verify services are running:
- PostgreSQL on `localhost:5432`
- LocalStack SQS on `localhost:4566`
- App 1 on `http://localhost:3001`
- App 2 on `http://localhost:3002`
- App 3 on `http://localhost:3003`

### 3. Run Locally (Development Mode)

If running directly on the host machine:

```bash
# Apply SQL Migrations
bun run migration:up

# Start development server with hot-reload
bun run start:dev
```

---

## 🧪 Testing

### Run All Unit Tests
Covers `Money`, `Wallet` invariants, `WagerTransaction` transitions, balanced ledger rules, and use cases:

```bash
bun run test
```

### Run Concurrency & Race Condition Tests
Tests real parallel contention across multiple instances, 50 simultaneous identical bets, hot-wallet balance exhaustion, outbox publisher races, and worker crash recovery:

```bash
bun run test:concurrency
```

### Run Load Test
Measures throughput, latency percentiles (p50, p95, p99), error rates, and performs post-run ledger reconciliation:

```bash
bun run test:load
```

### Run Complete Test Suite

```bash
bun run test:all
```

### Run TypeScript Type Check

```bash
bun run typecheck
```

---

## 📡 API Endpoints

### 1. Wallets

#### Create Wallet
```http
POST /wallets
Content-Type: application/json

{
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "initialBalance": { "amount": "1000.00", "currency": "BRL" }
}
```
*Creates wallet and, if initial balance > 0, atomically inserts internal OPENING transaction and CREDIT ledger entry.*

#### Get Wallet
```http
GET /wallets/:walletId
```

#### Get Ledger (Cursor Pagination)
```http
GET /wallets/:walletId/ledger?limit=50&cursor=...
```

#### Reconcile Wallet Balance
```http
POST /wallets/:walletId/reconciliation
```
*Calculates reconstructed balance directly from the sum of immutable ledger entries and asserts `wallet.balance == sum(ledger)`.*

---

### 2. Wagering Transactions

#### Submit Wagering Transaction
```http
POST /wagering/transactions
Idempotency-Key: provider-a:transaction-123
Content-Type: application/json

{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "roundId": "round-987",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}
```

Response (`200 OK` on processed, `202 Accepted` on pending reference, `422 Unprocessable` on business rejection):
```json
{
  "transactionId": "0192f298-345e-7e38-af88-e43f851a819d",
  "status": "PROCESSED",
  "balance": { "amount": "975.00", "currency": "BRL" },
  "idempotentReplay": false
}
```

#### Query Transaction
```http
GET /wagering/transactions/:transactionId
GET /providers/:providerId/wagering/transactions/:externalTransactionId
```

---

### 3. Health & Observability

```http
GET /health/live      # Liveness probe (process uptime)
GET /health/ready     # Readiness probe (PostgreSQL and SQS reachability)
GET /metrics          # Prometheus metrics format
```

---

## 📬 SQS FIFO Queue Processing

Queues:
- `wager-transactions.fifo`
- `wager-transactions-dlq.fifo`

Message Payload:
```json
{
  "messageId": "msg-123",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-07-29T15:00:00.000Z",
  "data": {
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "idempotencyKey": "provider-a:transaction-123",
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }
}
```

---

## 🏛 Architecture & Design Details

For in-depth explanations of:
- MikroORM Unit of Work and decimal mapping
- Row-level locking vs optimistic concurrency
- Idempotency hashing algorithm
- Outbox pattern and DLQ retry strategy
- External IdP (Keycloak / Zitadel) integration design
- Complete failure code taxonomy

Please refer to [ARCHITECTURE.md](ARCHITECTURE.md).
