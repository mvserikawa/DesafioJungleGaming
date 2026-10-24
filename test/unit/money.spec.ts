import { describe, expect, it } from 'bun:test';
import { CurrencyMismatchError, InvalidMoneyError } from '../../src/domain/errors/domain-errors';
import { Money } from '../../src/domain/models/money';

describe('Money Value Object', () => {
  it('creates money from valid decimal string and currency', () => {
    const money = Money.from({ amount: '25.00', currency: 'BRL' });
    expect(money.toString()).toBe('25.00');
    expect(money.currency).toBe('BRL');
    expect(money.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
  });

  it('formats amount to fixed 2 decimal places', () => {
    const m1 = Money.from({ amount: '25', currency: 'BRL' });
    expect(m1.toString()).toBe('25.00');

    const m2 = Money.from({ amount: '25.5', currency: 'BRL' });
    expect(m2.toString()).toBe('25.50');
  });

  it('rejects more than 2 decimal places', () => {
    expect(() => Money.from({ amount: '25.001', currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
  });

  it('rejects negative amounts in contract inputs', () => {
    expect(() => Money.from({ amount: '-10.00', currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
  });

  it('rejects invalid number strings: empty, NaN, Infinity, scientific notation', () => {
    expect(() => Money.from({ amount: '', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: 'abc', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: '1e5', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: 'Infinity', currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
  });

  it('rejects invalid currency codes', () => {
    expect(() => Money.from({ amount: '10.00', currency: 'BR' })).toThrow(
      InvalidMoneyError,
    );
    expect(() => Money.from({ amount: '10.00', currency: '123' })).toThrow(
      InvalidMoneyError,
    );
  });

  it('creates zero money', () => {
    const zero = Money.zero('BRL');
    expect(zero.isZero()).toBe(true);
    expect(zero.toString()).toBe('0.00');
  });

  it('adds and subtracts money of same currency correctly', () => {
    const m1 = Money.from({ amount: '50.25', currency: 'BRL' });
    const m2 = Money.from({ amount: '25.50', currency: 'BRL' });

    const sum = m1.add(m2);
    expect(sum.toString()).toBe('75.75');

    const diff = m1.subtract(m2);
    expect(diff.toString()).toBe('24.75');
  });

  it('throws CurrencyMismatchError on operations between different currencies', () => {
    const brl = Money.from({ amount: '50.00', currency: 'BRL' });
    const usd = Money.from({ amount: '50.00', currency: 'USD' });

    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
  });

  it('supports comparison methods: isLessThan, equals, isPositive, isZero', () => {
    const m10 = Money.from({ amount: '10.00', currency: 'BRL' });
    const m20 = Money.from({ amount: '20.00', currency: 'BRL' });
    const m10b = Money.from({ amount: '10.00', currency: 'BRL' });

    expect(m10.isLessThan(m20)).toBe(true);
    expect(m20.isLessThan(m10)).toBe(false);
    expect(m10.equals(m10b)).toBe(true);
    expect(m10.isPositive()).toBe(true);
  });

  it('ensures immutability — operations return new instances', () => {
    const m1 = Money.from({ amount: '10.00', currency: 'BRL' });
    const m2 = Money.from({ amount: '5.00', currency: 'BRL' });
    const m3 = m1.add(m2);

    expect(m1.toString()).toBe('10.00');
    expect(m2.toString()).toBe('5.00');
    expect(m3.toString()).toBe('15.00');
    expect(m1).not.toBe(m3);
  });
});
