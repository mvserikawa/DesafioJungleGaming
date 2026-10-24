import { describe, expect, it } from 'bun:test';
import {
  InvalidTransactionStateError,
  UnbalancedLedgerEntryError,
} from '../../src/domain/errors/domain-errors';
import { FailureCode } from '../../src/domain/errors/failure-codes';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../src/domain/models/ledger-entry';
import { Money } from '../../src/domain/models/money';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../src/domain/models/wager-transaction';
import {
  canonicalizeJson,
  computeCanonicalPayloadHash,
} from '../../src/domain/utils/canonical-hash';

describe('WagerTransaction Entity', () => {
  const sampleMoney = Money.from({ amount: '50.00', currency: 'BRL' });

  it('creates a pending transaction for BET', () => {
    const tx = WagerTransaction.create({
      id: 'tx-1',
      providerId: 'provider-1',
      externalTransactionId: 'ext-1',
      idempotencyKey: 'provider-1:ext-1',
      payloadHash: 'hash-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: sampleMoney,
    });

    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.isTerminal()).toBe(false);
    expect(tx.affectsBalance()).toBe(true);
    expect(tx.requiresReference()).toBe(false);
    expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
  });

  it('requires reference for REFUND and ROLLBACK', () => {
    expect(() =>
      WagerTransaction.create({
        id: 'tx-refund',
        providerId: 'provider-1',
        externalTransactionId: 'ext-refund',
        idempotencyKey: 'key-ref',
        payloadHash: 'hash-ref',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Refund,
        money: sampleMoney,
      }),
    ).toThrow('REFUND requires a referenceExternalTransactionId');
  });

  it('transitions state correctly and prevents mutation once terminal', () => {
    const tx = WagerTransaction.create({
      id: 'tx-2',
      providerId: 'provider-1',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-1:ext-2',
      payloadHash: 'hash-2',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Win,
      money: sampleMoney,
    });

    tx.markProcessed(undefined, new Date());
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);

    // Attempting further transitions throws InvalidTransactionStateError
    expect(() => tx.reject(FailureCode.INSUFFICIENT_FUNDS)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => tx.fail(FailureCode.INTERNAL_ERROR)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => tx.markProcessed(undefined, new Date())).toThrow(
      InvalidTransactionStateError,
    );
  });

  it('computes rollback ledger direction as inverse of reference transaction', () => {
    const betTx = WagerTransaction.create({
      id: 'tx-bet',
      providerId: 'p1',
      externalTransactionId: 'e-bet',
      idempotencyKey: 'k-bet',
      payloadHash: 'h-bet',
      walletId: 'w1',
      playerId: 'pl1',
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Bet,
      money: sampleMoney,
    });

    const rollbackBet = WagerTransaction.create({
      id: 'tx-rb-bet',
      providerId: 'p1',
      externalTransactionId: 'e-rb-bet',
      idempotencyKey: 'k-rb-bet',
      payloadHash: 'h-rb-bet',
      walletId: 'w1',
      playerId: 'pl1',
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Rollback,
      money: sampleMoney,
      referenceExternalTransactionId: 'e-bet',
    });

    // Reference was BET (Debit), so Rollback produces Credit
    expect(rollbackBet.ledgerDirectionFor(betTx)).toBe(LedgerDirection.Credit);

    const winTx = WagerTransaction.create({
      id: 'tx-win',
      providerId: 'p1',
      externalTransactionId: 'e-win',
      idempotencyKey: 'k-win',
      payloadHash: 'h-win',
      walletId: 'w1',
      playerId: 'pl1',
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Win,
      money: sampleMoney,
    });

    const rollbackWin = WagerTransaction.create({
      id: 'tx-rb-win',
      providerId: 'p1',
      externalTransactionId: 'e-rb-win',
      idempotencyKey: 'k-rb-win',
      payloadHash: 'h-rb-win',
      walletId: 'w1',
      playerId: 'pl1',
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Rollback,
      money: sampleMoney,
      referenceExternalTransactionId: 'e-win',
    });

    // Reference was WIN (Credit), so Rollback produces Debit
    expect(rollbackWin.ledgerDirectionFor(winTx)).toBe(LedgerDirection.Debit);
  });
});

describe('WalletLedgerEntry', () => {
  it('creates a balanced DEBIT entry', () => {
    const entry = WalletLedgerEntry.create({
      id: 'ledger-1',
      walletId: 'w1',
      transactionId: 'tx1',
      direction: LedgerDirection.Debit,
      money: Money.from({ amount: '20.00', currency: 'BRL' }),
      balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
      balanceAfter: Money.from({ amount: '80.00', currency: 'BRL' }),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.balanceAfter.toString()).toBe('80.00');
  });

  it('creates a balanced CREDIT entry', () => {
    const entry = WalletLedgerEntry.create({
      id: 'ledger-2',
      walletId: 'w1',
      transactionId: 'tx2',
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: '50.00', currency: 'BRL' }),
      balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
      balanceAfter: Money.from({ amount: '150.00', currency: 'BRL' }),
    });

    expect(entry.isBalanced()).toBe(true);
  });

  it('rejects an unbalanced ledger entry', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'ledger-invalid',
        walletId: 'w1',
        transactionId: 'tx3',
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: '20.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '90.00', currency: 'BRL' }), // wrong: 100 - 20 !== 90
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });
});

describe('Canonical Payload Hashing', () => {
  it('produces identical hash regardless of key order', () => {
    const payload1 = {
      providerId: 'p1',
      roundId: 'r1',
      money: { amount: '25.00', currency: 'BRL' },
      kind: 'BET',
    };

    const payload2 = {
      kind: 'BET',
      money: { currency: 'BRL', amount: '25.00' },
      providerId: 'p1',
      roundId: 'r1',
    };

    expect(canonicalizeJson(payload1)).toBe(canonicalizeJson(payload2));
    expect(computeCanonicalPayloadHash(payload1)).toBe(
      computeCanonicalPayloadHash(payload2),
    );
  });

  it('produces different hash if any business value changes', () => {
    const payload1 = {
      providerId: 'p1',
      money: { amount: '25.00', currency: 'BRL' },
    };

    const payload2 = {
      providerId: 'p1',
      money: { amount: '25.01', currency: 'BRL' },
    };

    expect(computeCanonicalPayloadHash(payload1)).not.toBe(
      computeCanonicalPayloadHash(payload2),
    );
  });
});
