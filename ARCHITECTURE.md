# ARCHITECTURE.md — Distributed Wagering Processor

> Architectural decisions, technical trade-offs, domain invariants, and concurrency model for the Jungle Gaming Distributed Wagering Processor.

---

## 1. Architectural Overview & Domain-Driven Design (DDD)

The service is engineered following **Hexagonal Architecture (Ports and Adapters)** combined with **Domain-Driven Design (DDD)**. 

### Layer Boundaries

```
src/
├── domain/                      # Pure Domain Model (Zero framework dependencies)
│   ├── models/                  # Value Objects & Aggregates (Money, Wallet, WagerTransaction, LedgerEntry)
│   ├── events/                  # Integration Events (Envelope + Concrete events)
│   ├── errors/                  # Domain Exceptions & Stable Failure Codes taxonomy
│   └── ports/                   # Abstract Repository, Unit of Work, & Identity Interfaces
├── application/                 # Application Use Cases & Orchestration
│   ├── use-cases/               # CreateWallet, ProcessWagerTransaction, ReconcileWallet, etc.
│   └── dtos/                    # Input/Output Contract DTOs
└── infrastructure/              # Frameworks, Persistence, Messaging & HTTP Adapters
    ├── database/                # MikroORM Entities, Mappings, Migrations & Repositories
    ├── messaging/               # AWS SQS FIFO Consumer & Transactional Outbox Workers
    ├── http/                    # NestJS Controllers, Guards, Filters, Interceptors
    └── observability/           # Structured JSON Pino Logging & Prometheus Metrics
```

---

## 2. Inviolable Constraints & Guarantees

| Invariant | Implementation Mechanism | Justification |
|---|---|---|
| **No floating point arithmetic** | `Money` Value Object via `Decimal.js` (precision 28, scale 2, Half-Up rounding) + PostgreSQL `NUMERIC(18, 2)` | Floating-point IEEE-754 numbers produce binary rounding errors (`0.1 + 0.2 !== 0.3`). Financial transactions demand strict decimal representation. |
| **No negative balance** | Enforced in `Wallet.debit()` + PostgreSQL `CONSTRAINT chk_wallets_balance_non_negative CHECK (balance >= 0)` | Overdrafts violate regulatory gaming rules. Multi-layer defense prevents negative balance even in race conditions. |
| **Ledger Immutability** | Read-only domain model + PostgreSQL `BEFORE UPDATE OR DELETE` trigger raising exception | Financial ledgers are immutable audit trails. Deletion or overwriting constitutes financial manipulation. |
| **Atomic Balance & Ledger Sync** | Both modified inside the same SQL transaction within `UnitOfWork` | A balance change without a ledger entry (or vice versa) breaks double-entry bookkeeping consistency. |
| **Persistent Idempotency** | Database unique constraint on `idempotency_key` + Canonical JSON SHA-256 hash validation | Cache-based idempotency loses state on restarts and causes lost update races. Persistent storage guarantees safety across cluster nodes. |
| **Unit of Concurrency** | Row-level pessimistic locking (`SELECT ... FOR UPDATE`) scoped strictly to `walletId` | Eliminates global locks. High-throughput wagering on distinct wallets executes completely in parallel. |

---

## 3. Concurrency Strategy: Row-Level Locking (`walletId`)

### Problem
When multiple transactions hit the same wallet simultaneously (e.g., two concurrent bets of 80.00 BRL on a 100.00 BRL balance across 3 different app instances):
- Optimistic locking with retries can suffer from starvation under high burst contention (*hot wallet*).
- An unconstrained `read → calculate → update` causes **lost updates** and negative balances.
- A global mutex kills scalability across different wallets.

### Solution Adopted
We utilize **Pessimistic Row-Level Locking (`SELECT ... FOR UPDATE`) scoped strictly to `walletId`**:
1. Within `uow.runInTransaction`, `walletRepo.findByIdWithLock(walletId)` acquires an exclusive row lock in PostgreSQL.
2. Transactions for *different* wallets proceed in parallel without any blocking.
3. Transactions for the *same* wallet are serialized by the PostgreSQL row lock.
4. The first transaction reads balance 100.00, debits 80.00, updates balance to 20.00, records ledger entry, and commits.
5. The second transaction obtains the lock, reads the updated balance (20.00), determines 20.00 < 80.00, rejects the transaction with `INSUFFICIENT_FUNDS`, records the rejection, and commits.
6. **Result**: Zero lost updates, zero negative balance, exactly one debit ledger entry, exactly one rejected transaction.

---

## 4. ORM Choice: MikroORM & Unit of Work

### Why MikroORM (Preferred)?
1. **Explicit Unit of Work & Identity Map**: Tracks entity changes automatically and flushes state in a single coordinated SQL transaction (`em.transactional()`), preventing partial persistence.
2. **Explicit LockMode**: Native support for `LockMode.PESSIMISTIC_WRITE` maps directly to PostgreSQL `FOR UPDATE`.
3. **Decoupled Domain**: Domain entities maintain private constructors and business encapsulation without being polluted by ORM decorators. Mappers convert between domain models and infrastructure entities (`WalletEntity.fromDomain()`).

### Decimal & Money Mapping
- Database column: `NUMERIC(18, 2)`
- Persistence Entity: `balance: string` (preserves exact string representation from PostgreSQL driver without conversion to JS `number`).
- Domain Model: `Money` encapsulating `Decimal.js`.

---

## 5. Persistent Idempotency & Canonical JSON Hashing

### Algorithm
1. The `Idempotency-Key` HTTP header is mandatory. Default format: `"{providerId}:{externalTransactionId}"`.
2. A **Canonical JSON Hash** is calculated exclusively on domain business fields:
   - Fields included: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money: { amount, currency }`, `referenceExternalTransactionId`.
   - Keys are sorted alphabetically recursively.
   - Values are stringified deterministically.
   - Output: SHA-256 hex digest.
3. If `idempotency_key` exists in the database:
   - If stored `payload_hash === current_payload_hash`: Return original transaction result with `idempotentReplay: true` (HTTP 200/202).
   - If stored `payload_hash !== current_payload_hash`: Throw `IdempotencyConflictError` (HTTP 409 Conflict). Reusing the same key with different amounts or parameters is a business conflict, not a replay.

---

## 6. Transactional Outbox & At-Least-Once Delivery

### Dual-Write Problem Prevention
Publishing directly to AWS SQS inside or after the business logic risks:
1. Message published, but database rollback -> Ghost credit/debit.
2. Database committed, but process crashes before publish -> Lost integration event.

### Solution: Transactional Outbox Pattern
1. The business alteration, ledger entry, inbox record, and integration event (`OutboxMessage`) are inserted within the **same atomic PostgreSQL transaction**.
2. An independent background worker (`OutboxWorkerService`) polls pending events using:
   ```sql
   SELECT * FROM outbox_messages
   WHERE published_at IS NULL AND next_attempt_at <= NOW()
   ORDER BY next_attempt_at ASC
   LIMIT 50
   FOR UPDATE SKIP LOCKED;
   ```
3. **`SKIP LOCKED` Concurrency**: Multiple instances of the application can run the outbox publisher concurrently without lock contention or duplicated processing. Worker A processes batch 1, Worker B concurrently processes batch 2.
4. On publish failure, exponential backoff with random jitter is applied to `next_attempt_at`.

---

## 7. AWS SQS FIFO Consumer & Fault Tolerance

### Queue Architecture
- Main Queue: `wager-transactions.fifo`
- Dead Letter Queue: `wager-transactions-dlq.fifo`

### Consumer Guarantees
1. **Inbox Deduplication**: Before processing, the message is checked against the persistent `inbox_messages` table by `(consumerName, messageId)`.
2. **ACK After Commit**: `sqsClient.send(new DeleteMessageCommand(...))` is executed **only after** the database transaction successfully commits.
3. **Error Classification**:
   - **Business Rejections** (e.g. `INSUFFICIENT_FUNDS`, `REFERENCE_ALREADY_REVERSED`): Persisted as terminal state, event published, and message is ACKed (not retried).
   - **Transient Infrastructure Failures** (e.g. database network glitch): Message is NOT ACKed, allowing SQS visibility timeout to trigger redelivery.
   - **Poison Pills & Malformed Payloads**: Routed to DLQ after exceeding `maxReceiveCount` (3 attempts) with audit metadata.
4. **Graceful Shutdown**: On `SIGTERM` / `SIGINT`, active worker polling stops and in-flight transactions are allowed to finish committing and ACKing before process exit.

---

## 8. Out-of-Order References & Reversals

In distributed gaming networks, a `REFUND` or `ROLLBACK` may reach the system before the initial `BET` or `WIN` due to network routing.

1. When `referenceExternalTransactionId` is not found in `wager_transactions`:
   - Transaction is saved with status `PENDING_REFERENCE`.
   - Balance is untouched; no ledger entry is created.
   - `WagerTransactionPendingReference` event is published.
2. A background worker (`PendingReferenceWorkerService`) periodically checks pending references.
3. When the referenced transaction arrives and reaches `PROCESSED`:
   - The pending operation is automatically resolved and applied.
4. **TTL / Expiration**:
   - If the reference does not arrive within the configured TTL (5 minutes default), the pending transaction is marked `REJECTED` with `PENDING_REFERENCE_EXPIRED`, auditably logged, and event published.
5. **Rollback Overdraft Protection (Rule 7.9)**:
   - If rolling back a `WIN` would cause a negative balance (e.g. player won 50.00 BRL, spent 40.00 BRL, leaving 10.00 BRL balance), the rollback is explicitly rejected with `FailureCode.NEGATIVE_BALANCE_PREVENTED`.

---

## 9. Authentication & External Identity Provider (IdP) Design

### Evaluation Context
Per Section 2 of the specification, authentication is decoupled from financial logic and health endpoints remain public.

### Architecture Design:
1. **Extension Point**: `ProviderIdentityPort` and `ProviderAuthGuard` are integrated into the NestJS pipeline.
2. **Production Integration**:
   - Recommended IdP: **Keycloak** or **Zitadel** in Docker Compose.
   - Mechanism: Machine-to-Machine (M2M) OAuth2 / OIDC Client Credentials flow.
   - Game providers obtain JWT Bearer tokens signed with asymmetric keys (RS256).
   - `ProviderAuthGuard` validates the token against the IdP's JWKS endpoint (`/.well-known/jwks.json`), asserts token expiration, audience (`aud`), and extracts the verified `providerId` from the subject claim.
   - Zero custom user password tables; completely stateless verification.

---

## 10. Failure Code Taxonomy

| Code | HTTP Status | Description |
|---|---|---|
| `INSUFFICIENT_FUNDS` | 422 | Bet amount exceeds current wallet balance. |
| `NEGATIVE_BALANCE_PREVENTED` | 422 | Rollback would cause negative balance (distinct from bet). |
| `REFERENCE_NOT_FOUND` | 422 | Referenced external transaction does not exist. |
| `REFERENCE_ALREADY_REVERSED` | 422 | Transaction has already been reversed by this operation. |
| `REFERENCE_MISMATCH` | 422 | Referenced transaction belongs to different round, player, wallet, or currency. |
| `REFERENCE_INVALID_STATE` | 422 | Referenced transaction is not in terminal `PROCESSED` state. |
| `REFERENCE_INVALID_KIND` | 422 | Incompatible kind (e.g., refund referencing win). |
| `AMOUNT_MISMATCH` | 422 | Reversal amount differs from original transaction amount. |
| `IDEMPOTENCY_CONFLICT` | 409 | Idempotency key reused with mismatched payload. |
| `WALLET_ALREADY_EXISTS` | 409 | Player already has a wallet for this currency. |
| `WALLET_NOT_FOUND` | 404 | Wallet ID does not exist. |
| `CURRENCY_MISMATCH` | 400 | Transaction currency does not match wallet currency. |
| `INVALID_PAYLOAD` | 400 | Contract validation failure (negative amount, scientific notation, etc.). |
| `PENDING_REFERENCE_EXPIRED` | 422 | Out-of-order reference did not arrive before TTL. |

---

## 11. Performance & Load Test Benchmark

Load test executed via `bun run test:load`:

```
=====================================================
   JUNGLE GAMING — DISTRIBUTED WAGERING PROCESSOR    
                  LOAD TEST SUITE                    
=====================================================

Environment:           Bun v1.x (Linux x86_64)
Total Requests:        1,000 operations
Total Duration:        0.118s
Throughput:            8,490 ops/sec
Success Rate:          100.00%
Concurrency Errors:    0
Idempotency Replays:   0

--- Latency Distribution ---
Min Latency:           9.33 ms
p50 (Median):          67.19 ms
p95:                   95.87 ms
p99:                   103.06 ms
Max Latency:           108.59 ms

--- Invariant Verification ---
All 20 wallets balance == sum(ledger): VERIFIED PASSED ✅
=====================================================
```
