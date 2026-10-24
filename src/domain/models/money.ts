import Decimal from 'decimal.js';
import { CurrencyMismatchError, InvalidMoneyError } from '../errors/domain-errors';

export interface MoneyProps {
  amount: string; // decimal string, ex: "25.00"
  currency: string; // ISO-4217 uppercase, ex: "BRL"
}

// Ensure fixed 2 decimal places and standard half-up rounding
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  public static from(props: MoneyProps): Money {
    if (!props || typeof props.amount !== 'string' || typeof props.currency !== 'string') {
      throw new InvalidMoneyError('MoneyProps must contain string amount and currency');
    }

    const trimmedCurrency = props.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(trimmedCurrency)) {
      throw new InvalidMoneyError(`Invalid currency code: ${props.currency}`);
    }

    const trimmedAmount = props.amount.trim();
    if (!trimmedAmount) {
      throw new InvalidMoneyError('Amount string cannot be empty');
    }

    // Reject scientific notation, NaN, Infinity, negative values in input contracts
    if (/e/i.test(trimmedAmount)) {
      throw new InvalidMoneyError('Scientific notation is not supported');
    }

    // Must be positive or zero decimal with at most 2 decimal places
    if (!/^\d+(\.\d{1,2})?$/.test(trimmedAmount)) {
      throw new InvalidMoneyError(
        `Invalid amount format: "${props.amount}". Must be non-negative with at most 2 decimal places.`,
      );
    }

    let dec: Decimal;
    try {
      dec = new Decimal(trimmedAmount);
    } catch {
      throw new InvalidMoneyError(`Failed to parse amount: ${props.amount}`);
    }

    if (!dec.isFinite() || dec.isNaN()) {
      throw new InvalidMoneyError('Amount must be finite and not NaN');
    }

    if (dec.isNegative()) {
      throw new InvalidMoneyError('Amount cannot be negative in contract inputs');
    }

    return new Money(dec, trimmedCurrency);
  }

  public static zero(currency: string): Money {
    const trimmedCurrency = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(trimmedCurrency)) {
      throw new InvalidMoneyError(`Invalid currency code: ${currency}`);
    }
    return new Money(new Decimal(0), trimmedCurrency);
  }

  /**
   * Rehydrates money from database or internal state without contract validations.
   */
  public static rehydrate(amount: string | number | Decimal, currency: string): Money {
    const trimmedCurrency = currency.trim().toUpperCase();
    const dec = new Decimal(amount);
    return new Money(dec, trimmedCurrency);
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  public negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  public isZero(): boolean {
    return this.value.isZero();
  }

  public isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  public isNegative(): boolean {
    return this.value.isNegative();
  }

  public isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  public equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  public toJSON(): MoneyProps {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  public toString(): string {
    return this.value.toFixed(2);
  }

  public toDecimal(): Decimal {
    return this.value;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
