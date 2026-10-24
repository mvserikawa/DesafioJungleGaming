# Distributed Wagering Processor — Jungle Gaming 🦧

Financial distributed wagering transaction processor built with **Bun 1.x**, **TypeScript** (strict mode), **NestJS**, **MikroORM**, **PostgreSQL**, and **AWS SQS** (LocalStack).

---

## 🚀 Recursos

- **Precisão financeira rigorosa**: Escala fixa e exata de 2 casas decimais usando `Money` Value Object via `Decimal.js` and PostgreSQL `NUMERIC(18, 2)`. Nenhum uso de tipos de ponto flutuante `number` ou `float`.
- **Idempotência persistente**: Cryptographic SHA-256 canonical JSON payload hashing with PostgreSQL unique constraints. Distingue reenvios idênticos de conflitos no conteúdo da requisição.
- **Bloqueio pessimista em nível de linha**: Scoped strictly to `walletId` (`SELECT ... FOR UPDATE`), serializando operações em carteiras disputadas sem bloqueios globais.
- **Ledger imutável**: Append-only ledger entries guarded by domain rules and physical PostgreSQL database triggers impedindo operações `UPDATE` e `DELETE`.
- **Outbox e Inbox transacionais**: Guarantees atomic writes between wallet balance, ledger entry, inbox deduplication, and integration events using `FOR UPDATE SKIP LOCKED`.
- **Processamento tolerante a falhas com SQS FIFO**: At-least-once delivery handling, poison pill routing to Dead Letter Queue (DLQ), e encerramento controlado com `SIGTERM`.
- **Resolução de referências fora de ordem**: `REFUND` and `ROLLBACK` que chegam antes da `BET` referenciada são persistidas como `PENDING_REFERENCE` e reconciliadas automaticamente por um worker em segundo plano.
- **Alto desempenho**: Achieves **>8,000 ops/sec** throughput with sub-100ms p95 latencies.

---

## 🛠 Tecnologias utilizadas

| Component | Technology |
|---|---|
| **Ambiente de execução e executor de testes** | **Bun 1.x** |
| **Linguagem** | **TypeScript 5.x** (Strict Mode) |
| **Framework** | **NestJS 10.x** |
| **Banco de dados** | **PostgreSQL 16** |
| **ORM** | **MikroORM 6.x** (Unit of Work, Identity Map, LockMode) |
| **Mensageria** | **AWS SQS FIFO** via LocalStack |
| **Orquestração** | **Docker Compose** (PostgreSQL, LocalStack, 3 App instances) |
| **Observabilidade** | **Pino** (JSON logging) & **Prometheus** (`prom-client`) |

---

## 📋 Pré-requisitos

- [Bun](https://bun.sh) (v1.0+)
- [Docker](https://www.docker.com/) & Docker Compose

---

## ⚡ Início rápido

### 1. Clonar o repositório e instalar dependências

```bash
git clone <repository-url>
cd DesafioJungleGaming
bun install
```

### 2. Iniciar a infraestrutura com Docker Compose

Para iniciar o PostgreSQL, o LocalStack (SQS) e 3 instâncias simultâneas da aplicação:

```bash
docker compose up -d
```

Verifique se os serviços estão em execução:
- PostgreSQL on `localhost:5432`
- LocalStack SQS on `localhost:4566`
- App 1 on `http://localhost:3001`
- App 2 on `http://localhost:3002`
- App 3 on `http://localhost:3003`

### 3. Executar localmente (modo de desenvolvimento)

Se executar diretamente na máquina hospedeira:

```bash
# Apply SQL Migrations
bun run migration:up

# Start development server with hot-reload
bun run start:dev
```

---

## 🧪 Testes

### Executar todos os testes unitários
Abrange `Money`, invariantes de `Wallet`, transições de `WagerTransaction`, regras de equilíbrio do ledger e casos de uso:

```bash
bun run test
```

### Executar testes de concorrência e condições de corrida
Testa disputas paralelas reais entre várias instâncias, 50 apostas idênticas simultâneas, esgotamento do saldo de uma carteira concorrida, condições de corrida entre publicadores da outbox e recuperação após falha de workers:

```bash
bun run test:concurrency
```

### Executar teste de carga
Mede vazão, percentis de latência (p50, p95, p99), taxas de erro e realiza a reconciliação do ledger após a execução:

```bash
bun run test:load
```

### Executar a suíte completa de testes

```bash
bun run test:all
```

### Verificar os tipos do TypeScript

```bash
bun run typecheck
```

---

## 📡 Endpoints da API

### 1. Carteiras

#### Criar carteira
```http
POST /wallets
Content-Type: application/json

{
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "initialBalance": { "amount": "1000.00", "currency": "BRL" }
}
```
*Cria a carteira e, se o saldo inicial for maior que zero, insere atomicamente a transação interna OPENING e um lançamento CREDIT no ledger.*

#### Consultar carteira
```http
GET /wallets/:walletId
```

#### Consultar ledger (paginação por cursor)
```http
GET /wallets/:walletId/ledger?limit=50&cursor=...
```

#### Reconciliar saldo da carteira
```http
POST /wallets/:walletId/reconciliation
```
*Calcula o saldo reconstruído diretamente pela soma dos lançamentos imutáveis do ledger e verifica `wallet.balance == sum(ledger)`.*

---

### 2. Transações de apostas

#### Enviar transação de aposta
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

Resposta (`200 OK` quando processada, `202 Accepted` quando aguarda referência, `422 Unprocessable` em caso de rejeição de negócio):
```json
{
  "transactionId": "0192f298-345e-7e38-af88-e43f851a819d",
  "status": "PROCESSED",
  "balance": { "amount": "975.00", "currency": "BRL" },
  "idempotentReplay": false
}
```

#### Consultar transação
```http
GET /wagering/transactions/:transactionId
GET /providers/:providerId/wagering/transactions/:externalTransactionId
```

---

### 3. Saúde e observabilidade

```http
GET /health/live      # Liveness probe (process uptime)
GET /health/ready     # Readiness probe (PostgreSQL and SQS reachability)
GET /metrics          # Prometheus metrics format
```

---

## 📬 Processamento da fila SQS FIFO

Filas:
- `wager-transactions.fifo`
- `wager-transactions-dlq.fifo`

Conteúdo da mensagem:
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

## 🏛 Detalhes de arquitetura e design

Para explicações detalhadas sobre:
- MikroORM Unit of Work and decimal mapping
- Row-level locking vs optimistic concurrency
- Idempotency hashing algorithm
- Outbox pattern and DLQ retry strategy
- External IdP (Keycloak / Zitadel) integration design
- Complete failure code taxonomy

Consulte [ARCHITECTURE.md](ARCHITECTURE.md).
