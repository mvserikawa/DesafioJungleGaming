import {
  CurrencyMismatchError,
  InsufficientFundsError,
} from '../errors/domain-errors';
import { Money, MoneyProps } from './money';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: MoneyProps | Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  public static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
  }): Wallet {
    const now = new Date();
    // version starts at 1 after creation
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );
  }

  /**
   * Reconstrução a partir da persistência — não revalida transições.
   */
  public static rehydrate(state: WalletState): Wallet {
    const balance =
      state.balance instanceof Money ? state.balance : Money.from(state.balance);
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  public get balance(): Money {
    return this._balance;
  }

  public get version(): number {
    return this._version;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  public canDebit(money: Money): boolean {
    this.assertSameCurrency(money);
    return !this._balance.isLessThan(money);
  }

  public debit(
    money: Money,
    now: Date = new Date(),
  ): { balanceBefore: Money; balanceAfter: Money; newVersion: number } {
    this.assertSameCurrency(money);

    if (this._balance.isLessThan(money)) {
      throw new InsufficientFundsError(
        this.id,
        money.toString(),
        this._balance.toString(),
      );
    }

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.subtract(money);

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = now;

    return {
      balanceBefore,
      balanceAfter,
      newVersion: this._version,
    };
  }

  public credit(
    money: Money,
    now: Date = new Date(),
  ): { balanceBefore: Money; balanceAfter: Money; newVersion: number } {
    this.assertSameCurrency(money);

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.add(money);

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = now;

    return {
      balanceBefore,
      balanceAfter,
      newVersion: this._version,
    };
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
