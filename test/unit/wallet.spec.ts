import { describe, expect, it } from 'bun:test';
import { CurrencyMismatchError, InsufficientFundsError } from '../../src/domain/errors/domain-errors';
import { Money } from '../../src/domain/models/money';
import { Wallet } from '../../src/domain/models/wallet';

describe('Wallet Aggregate Root', () => {
  it('opens a new wallet with initial balance and version 1', () => {
    const initial = Money.from({ amount: '100.00', currency: 'BRL' });
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: initial,
    });

    expect(wallet.id).toBe('wallet-1');
    expect(wallet.playerId).toBe('player-1');
    expect(wallet.currency).toBe('BRL');
    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('credits wallet, increments version and updates balance', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '50.00', currency: 'BRL' }),
    });

    const creditAmount = Money.from({ amount: '25.00', currency: 'BRL' });
    const result = wallet.credit(creditAmount);

    expect(result.balanceBefore.toString()).toBe('50.00');
    expect(result.balanceAfter.toString()).toBe('75.00');
    expect(result.newVersion).toBe(2);
    expect(wallet.balance.toString()).toBe('75.00');
    expect(wallet.version).toBe(2);
  });

  it('debits wallet when balance is sufficient', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    const debitAmount = Money.from({ amount: '40.00', currency: 'BRL' });
    const result = wallet.debit(debitAmount);

    expect(result.balanceBefore.toString()).toBe('100.00');
    expect(result.balanceAfter.toString()).toBe('60.00');
    expect(result.newVersion).toBe(2);
    expect(wallet.balance.toString()).toBe('60.00');
    expect(wallet.version).toBe(2);
  });

  it('rejects debit when balance is insufficient without mutating state', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '50.00', currency: 'BRL' }),
    });

    const debitAmount = Money.from({ amount: '80.00', currency: 'BRL' });
    expect(() => wallet.debit(debitAmount)).toThrow(InsufficientFundsError);

    // State remains unchanged
    expect(wallet.balance.toString()).toBe('50.00');
    expect(wallet.version).toBe(1);
  });

  it('rejects operations with different currencies', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '50.00', currency: 'BRL' }),
    });

    const usdMoney = Money.from({ amount: '10.00', currency: 'USD' });
    expect(() => wallet.debit(usdMoney)).toThrow(CurrencyMismatchError);
    expect(() => wallet.credit(usdMoney)).toThrow(CurrencyMismatchError);
    expect(() => wallet.canDebit(usdMoney)).toThrow(CurrencyMismatchError);
  });

  it('rehydrates wallet from persisted state', () => {
    const past = new Date('2026-01-01T00:00:00Z');
    const wallet = Wallet.rehydrate({
      id: 'wallet-rehydrated',
      playerId: 'player-99',
      currency: 'BRL',
      balance: { amount: '350.75', currency: 'BRL' },
      version: 5,
      createdAt: past,
      updatedAt: past,
    });

    expect(wallet.id).toBe('wallet-rehydrated');
    expect(wallet.balance.toString()).toBe('350.75');
    expect(wallet.version).toBe(5);
  });
});
