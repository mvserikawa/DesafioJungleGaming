import { UnbalancedLedgerEntryError } from '../errors/domain-errors';
import { Money, MoneyProps } from './money';

export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt?: Date;
}

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps | Money;
  balanceBefore: MoneyProps | Money;
  balanceAfter: MoneyProps | Money;
  createdAt: Date;
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  public static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt ?? new Date(),
    );

    if (!entry.isBalanced()) {
      throw new UnbalancedLedgerEntryError(
        `Entry ${entry.id} is not balanced: direction=${entry.direction}, ` +
          `before=${entry.balanceBefore.toString()}, money=${entry.money.toString()}, ` +
          `after=${entry.balanceAfter.toString()}`,
      );
    }

    return entry;
  }

  public static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    const money = state.money instanceof Money ? state.money : Money.from(state.money);
    const balanceBefore =
      state.balanceBefore instanceof Money
        ? state.balanceBefore
        : Money.from(state.balanceBefore);
    const balanceAfter =
      state.balanceAfter instanceof Money
        ? state.balanceAfter
        : Money.from(state.balanceAfter);

    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      money,
      balanceBefore,
      balanceAfter,
      state.createdAt,
    );
  }

  public isBalanced(): boolean {
    if (this.direction === LedgerDirection.Debit) {
      return this.balanceBefore.subtract(this.money).equals(this.balanceAfter);
    }

    if (this.direction === LedgerDirection.Credit) {
      return this.balanceBefore.add(this.money).equals(this.balanceAfter);
    }

    return false;
  }
}
