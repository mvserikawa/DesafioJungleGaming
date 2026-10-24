# ARCHITECTURE.md — Distributed Wagering Processor

> Decisões arquiteturais, compensações técnicas, invariantes de domínio e modelo de concorrência do processador distribuído de transações de apostas da Jungle Gaming.

---

## 1. Visão geral da arquitetura e Design Orientado a Domínio (DDD)

O serviço foi projetado seguindo **Hexagonal Architecture (Ports and Adapters)** combined with **Domain-Driven Design (DDD)**. 

### Limites entre camadas

```
src/
├── domain/                      # Modelo de domínio puro (sem dependências de frameworks)
│   ├── models/                  # Objetos de valor e agregados (Money, Wallet, WagerTransaction, LedgerEntry)
│   ├── events/                  # Eventos de integração (envelope + eventos concretos)
│   ├── errors/                  # Exceções de domínio e taxonomia estável de códigos de falha
│   └── ports/                   # Interfaces abstratas de repositório, Unit of Work e identidade
├── application/                 # Casos de uso da aplicação e orquestração
│   ├── use-cases/               # CreateWallet, ProcessWagerTransaction, ReconcileWallet, etc.
│   └── dtos/                    # DTOs de contratos de entrada e saída
└── infrastructure/              # Frameworks, persistência, mensageria e adaptadores HTTP
    ├── database/                # Entidades MikroORM, mapeamentos, migrations e repositórios
    ├── messaging/               # Consumidor AWS SQS FIFO e workers da Outbox transacional
    ├── http/                    # Controllers, guards, filtros e interceptors do NestJS
    └── observability/           # Logs JSON estruturados com Pino e métricas do Prometheus
```

---

## 2. Restrições e garantias invioláveis

| Invariante | Mecanismo de implementação | Justificativa |
|---|---|---|
| **Nenhuma operação aritmética de ponto flutuante** | `Money` Value Object via `Decimal.js` (precision 28, scale 2, Half-Up rounding) + PostgreSQL `NUMERIC(18, 2)` | Números de ponto flutuante IEEE-754 produzem erros de arredondamento binário (`0.1 + 0.2 !== 0.3`). Transações financeiras exigem representação decimal exata. |
| **Nenhum saldo negativo** | Enforced in `Wallet.debit()` + PostgreSQL `CONSTRAINT chk_wallets_balance_non_negative CHECK (balance >= 0)` | Saldos negativos violam as regras regulatórias de jogos. A defesa em múltiplas camadas impede saldo negativo até mesmo em condições de corrida. |
| **Imutabilidade do ledger** | Read-only domain model + PostgreSQL `BEFORE UPDATE OR DELETE` trigger raising exception | Ledgers financeiros são trilhas de auditoria imutáveis. Excluir ou sobrescrever lançamentos constitui manipulação financeira. |
| **Sincronização atômica entre saldo e ledger** | Both modified inside the same SQL transaction within `UnitOfWork` | Uma alteração de saldo sem lançamento no ledger (ou vice-versa) quebra a consistência contábil. |
| **Idempotência persistente** | Database unique constraint on `idempotency_key` + Canonical JSON SHA-256 hash validation | A idempotência baseada em cache perde o estado após reinicializações e pode causar condições de corrida. O armazenamento persistente garante segurança entre os nós do cluster. |
| **Unidade de concorrência** | Row-level pessimistic locking (`SELECT ... FOR UPDATE`) scoped strictly to `walletId` | Elimina bloqueios globais. Transações de alto volume em carteiras distintas são executadas totalmente em paralelo. |

---

## 3. Estratégia de concorrência: bloqueio em nível de linha (`walletId`)

### Problema
Quando várias transações atingem a mesma carteira simultaneamente (e.g., two concurrent bets of 80.00 BRL on a 100.00 BRL balance across 3 different app instances):
- Optimistic locking with retries can suffer from starvation under high burst contention (*hot wallet*).
- An unconstrained `read → calculate → update` causes **lost updates** and negative balances.
- A global mutex kills scalability across different wallets.

### Solução adotada
Utilizamos **Pessimistic Row-Level Locking (`SELECT ... FOR UPDATE`) scoped strictly to `walletId`**:
1. Dentro de `uow.runInTransaction`, `walletRepo.findByIdWithLock(walletId)` obtém um bloqueio exclusivo da linha no PostgreSQL.
2. Transações de carteiras *diferentes* prosseguem em paralelo, sem bloqueios.
3. Transações da *mesma* carteira são serializadas pelo bloqueio de linha do PostgreSQL.
4. A primeira transação lê o saldo de 100.00, debita 80.00, atualiza o saldo para 20.00, registra o lançamento no ledger e confirma a transação.
5. A segunda transação obtém o bloqueio, lê o saldo atualizado (20.00), identifica que 20.00 < 80.00, rejeita a transação com `INSUFFICIENT_FUNDS`, registra a rejeição e confirma a transação.
6. **Resultado**: nenhuma atualização perdida, nenhum saldo negativo, exatamente um lançamento de débito no ledger e exatamente uma transação rejeitada.

---

## 4. Escolha do ORM: MikroORM e Unit of Work

### Por que MikroORM (preferencial)?
1. **Explicit Unit of Work & Identity Map**: Rastreia alterações nas entidades automaticamente e persiste o estado em uma única transação SQL coordenada (`em.transactional()`), preventing partial persistence.
2. **Explicit LockMode**: Suporte nativo a `LockMode.PESSIMISTIC_WRITE` mapeia diretamente para o PostgreSQL `FOR UPDATE`.
3. **Decoupled Domain**: As entidades de domínio mantêm construtores privados e encapsulamento de negócio sem serem contaminadas por decorators do ORM. Mappers convert between domain models and infrastructure entities (`WalletEntity.fromDomain()`).

### Mapeamento de Decimal e Money
- Coluna do banco de dados: `NUMERIC(18, 2)`
- Entidade de persistência: `balance: string` (preserves exact string representation from PostgreSQL driver without conversion to JS `number`).
- Modelo de domínio: `Money` encapsulating `Decimal.js`.

---

## 5. Idempotência persistente & Canonical JSON Hashing

### Algoritmo
1. O cabeçalho HTTP `Idempotency-Key` é obrigatório. Formato padrão: `"{providerId}:{externalTransactionId}"`.
2. Um **hash de JSON canônico** é calculado exclusivamente sobre os campos de negócio do domínio:
   - Campos incluídos: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money: { amount, currency }`, `referenceExternalTransactionId`.
   - As chaves são ordenadas alfabeticamente de forma recursiva.
   - Os valores são convertidos em strings de forma determinística.
   - Output: SHA-256 hex digest.
3. Se `idempotency_key` já existir no banco de dados:
   - If stored `payload_hash === current_payload_hash`: Retorna o resultado original da transação with `idempotentReplay: true` (HTTP 200/202).
   - If stored `payload_hash !== current_payload_hash`: Throw `IdempotencyConflictError` (HTTP 409 Conflict). Reutilizar a mesma chave com valores ou parâmetros diferentes é um conflito de negócio, não uma repetição idempotente.

---

## 6. Outbox transacional e entrega pelo menos uma vez

### Prevenção do problema de gravação dupla
Publicar diretamente no AWS SQS durante ou após a lógica de negócio traz os riscos de:
1. Mensagem publicada, mas a transação do banco revertida -> crédito/débito fantasma.
2. Banco confirmado, mas o processo falha antes da publicação -> evento de integração perdido.

### Solução: padrão Outbox transacional
1. A alteração de negócio, o lançamento no ledger, o registro da inbox e o evento de integração (`OutboxMessage`) são inseridos dentro da **mesma transação atômica do PostgreSQL**.
2. Um worker independente em segundo plano (`OutboxWorkerService`) consulta eventos pendentes using:
   ```sql
   SELECT * FROM outbox_messages
   WHERE published_at IS NULL AND next_attempt_at <= NOW()
   ORDER BY next_attempt_at ASC
   LIMIT 50
   FOR UPDATE SKIP LOCKED;
   ```
3. **Concorrência com `SKIP LOCKED`**: várias instâncias da aplicação podem executar o publicador da outbox simultaneamente, sem disputa por bloqueios nem processamento duplicado. O Worker A processa o lote 1 enquanto o Worker B processa o lote 2 em paralelo.
4. Em caso de falha na publicação, aplica-se backoff exponencial com variação aleatória (*jitter*) a `next_attempt_at`.

---

## 7. Consumidor AWS SQS FIFO e tolerância a falhas

### Arquitetura das filas
- Main Queue: `wager-transactions.fifo`
- Dead Letter Queue: `wager-transactions-dlq.fifo`

### Garantias do consumidor
1. **Deduplicação pela Inbox**: antes do processamento, a mensagem é verificada na tabela persistente `inbox_messages` pela combinação `(consumerName, messageId)`.
2. **ACK após o commit**: `sqsClient.send(new DeleteMessageCommand(...))` é executado **somente após** a transação do banco ser confirmada com sucesso.
3. **Classificação de erros**:
   - **Rejeições de negócio** (e.g. `INSUFFICIENT_FUNDS`, `REFERENCE_ALREADY_REVERSED`): São persistidas em estado terminal, o evento é publicado e a mensagem recebe ACK (sem nova tentativa).
   - **Falhas transitórias de infraestrutura** (e.g. database network glitch): A mensagem não recebe ACK, permitindo que o tempo limite de visibilidade do SQS provoque uma nova entrega.
   - **Mensagens problemáticas e conteúdos malformados**: São encaminhados à DLQ após exceder `maxReceiveCount` (3 tentativas), com metadados de auditoria.
4. **Encerramento controlado**: On `SIGTERM` / `SIGINT`, a consulta de novas mensagens é interrompida e as transações em andamento podem concluir o commit e o ACK antes do encerramento do processo.

---

## 8. Referências fora de ordem e reversões

Em redes distribuídas de jogos, uma `REFUND` or `ROLLBACK` pode chegar ao sistema antes da `BET` or `WIN` due to network routing.

1. Quando `referenceExternalTransactionId` não é encontrado em `wager_transactions`:
   - Transaction is saved with status `PENDING_REFERENCE`.
   - O saldo não é alterado e nenhum lançamento é criado no ledger.
   - `WagerTransactionPendingReference` event is published.
2. Um worker em segundo plano (`PendingReferenceWorkerService`) verifica periodicamente as referências pendentes.
3. Quando a transação referenciada chega e alcança o estado `PROCESSED`:
   - A operação pendente é resolvida e aplicada automaticamente.
4. **TTL / Expiration**:
   - Se a referência não chegar dentro do TTL configurado (5 minutos por padrão), a transação pendente será marcada como `REJECTED` with `PENDING_REFERENCE_EXPIRED`, registrada para auditoria, e o evento será publicado.
5. **Rollback Overdraft Protection (Rule 7.9)**:
   - If rolling back a `WIN` would cause a negative balance (e.g. player won 50.00 BRL, spent 40.00 BRL, leaving 10.00 BRL balance), the rollback is explicitly rejected with `FailureCódigo.NEGATIVE_BALANCE_PREVENTED`.

---

## 9. Autenticação e design do provedor externo de identidade (IdP)

### Contexto da avaliação
De acordo com a seção 2 da especificação, a autenticação é desacoplada da lógica financeira e os endpoints de saúde permanecem públicos.

### Desenho da arquitetura:
1. **Ponto de extensão**: `ProviderIdentityPort` and `ProviderAuthGuard` are integrated into the NestJS pipeline.
2. **Integração em produção**:
   - IdP recomendado: **Keycloak** or **Zitadel** in Docker Compose.
   - Mecanismo: Machine-to-Machine (M2M) OAuth2 / OIDC Client Credentials flow.
   - Os provedores de jogos obtêm tokens JWT Bearer assinados com chaves assimétricas (RS256).
   - `ProviderAuthGuard` valida o token usando o endpoint JWKS do IdP (`/.well-known/jwks.json`), verifica a expiração do token e a audiência (`aud`), e extrai o `providerId` validado da declaração de sujeito.
   - Nenhuma tabela própria de senhas de usuários; validação totalmente sem estado.

---

## 10. Taxonomia de códigos de falha

| Código | Status HTTP | Descrição |
|---|---|---|
| `INSUFFICIENT_FUNDS` | 422 | O valor da aposta excede o saldo atual da carteira. |
| `NEGATIVE_BALANCE_PREVENTED` | 422 | O rollback causaria saldo negativo (situação distinta de uma aposta). |
| `REFERENCE_NOT_FOUND` | 422 | A transação externa referenciada não existe. |
| `REFERENCE_ALREADY_REVERSED` | 422 | A transação já foi revertida por esta operação. |
| `REFERENCE_MISMATCH` | 422 | A transação referenciada pertence a outra rodada, jogador, carteira ou moeda. |
| `REFERENCE_INVALID_STATE` | 422 | A transação referenciada não está no estado terminal `PROCESSED`. |
| `REFERENCE_INVALID_KIND` | 422 | Tipo incompatível (por exemplo, um reembolso que referencia uma vitória). |
| `AMOUNT_MISMATCH` | 422 | O valor da reversão difere do valor da transação original. |
| `IDEMPOTENCY_CONFLICT` | 409 | Chave de idempotência reutilizada com conteúdo divergente. |
| `WALLET_ALREADY_EXISTS` | 409 | O jogador já possui uma carteira nesta moeda. |
| `WALLET_NOT_FOUND` | 404 | O ID da carteira não existe. |
| `CURRENCY_MISMATCH` | 400 | A moeda da transação não corresponde à moeda da carteira. |
| `INVALID_PAYLOAD` | 400 | Falha na validação do contrato (valor negativo, notação científica etc.). |
| `PENDING_REFERENCE_EXPIRED` | 422 | A referência fora de ordem não chegou antes do TTL. |

---

## 11. Desempenho e resultados do teste de carga

Teste de carga executado por `bun run test:load`:

```
=====================================================
   JUNGLE GAMING — DISTRIBUTED WAGERING PROCESSOR    
                  LOAD TEST SUITE                    
=====================================================

Ambiente:           Bun v1.x (Linux x86_64)
Total de requisições:        1,000 operations
Duração total:        0.118s
Vazão:            8,490 ops/sec
Taxa de sucesso:          100.00%
Erros de concorrência:    0
Repetições idempotentes:   0

--- Distribuição da latência ---
Latência mínima:           9.33 ms
p50 (mediana):          67.19 ms
p95:                   95.87 ms
p99:                   103.06 ms
Latência máxima:           108.59 ms

--- Invariante Verification ---
Saldo das 20 carteiras == soma do ledger: VERIFICADO COM SUCESSO ✅
=====================================================
```
