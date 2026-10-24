import { FailureCode } from './failure-codes';

export abstract class DomainError extends Error {
  public abstract readonly code: FailureCode;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidMoneyError extends DomainError {
  public readonly code = FailureCode.INVALID_PAYLOAD;
  constructor(message: string) {
    super(`Invalid money: ${message}`);
  }
}

export class CurrencyMismatchError extends DomainError {
  public readonly code = FailureCode.CURRENCY_MISMATCH;
  constructor(expected: string, actual: string) {
    super(`Currency mismatch: expected ${expected}, got ${actual}`);
  }
}

export class InsufficientFundsError extends DomainError {
  public readonly code = FailureCode.INSUFFICIENT_FUNDS;
  constructor(walletId: string, required: string, available: string) {
    super(
      `Insufficient funds for wallet ${walletId}: required ${required}, available ${available}`,
    );
  }
}

export class NegativeBalancePreventedError extends DomainError {
  public readonly code = FailureCode.NEGATIVE_BALANCE_PREVENTED;
  constructor(walletId: string, attemptedReversal: string, available: string) {
    super(
      `Reversal would cause negative balance for wallet ${walletId}: reversal amount ${attemptedReversal}, available ${available}`,
    );
  }
}

export class WalletAlreadyExistsError extends DomainError {
  public readonly code = FailureCode.WALLET_ALREADY_EXISTS;
  constructor(playerId: string, currency: string) {
    super(`Wallet already exists for player ${playerId} with currency ${currency}`);
  }
}

export class WalletNotFoundError extends DomainError {
  public readonly code = FailureCode.WALLET_NOT_FOUND;
  constructor(walletId: string) {
    super(`Wallet with ID ${walletId} not found`);
  }
}

export class InvalidTransactionStateError extends DomainError {
  public readonly code = FailureCode.INVALID_TRANSACTION_STATE;
  constructor(transactionId: string, currentState: string, attemptedAction: string) {
    super(
      `Transaction ${transactionId} is in terminal or incompatible state "${currentState}"; cannot ${attemptedAction}`,
    );
  }
}

export class ReferenceNotFoundError extends DomainError {
  public readonly code = FailureCode.REFERENCE_NOT_FOUND;
  constructor(referenceExternalId: string, providerId: string) {
    super(
      `Referenced transaction "${referenceExternalId}" for provider "${providerId}" not found`,
    );
  }
}

export class ReferenceAlreadyReversedError extends DomainError {
  public readonly code = FailureCode.REFERENCE_ALREADY_REVERSED;
  constructor(referenceExternalId: string, reverseKind: string) {
    super(
      `Referenced transaction "${referenceExternalId}" has already been reversed by a ${reverseKind}`,
    );
  }
}

export class ReferenceMismatchError extends DomainError {
  public readonly code = FailureCode.REFERENCE_MISMATCH;
  constructor(reason: string) {
    super(`Referenced transaction mismatch: ${reason}`);
  }
}

export class AmountMismatchError extends DomainError {
  public readonly code = FailureCode.AMOUNT_MISMATCH;
  constructor(expected: string, actual: string) {
    super(`Reversal amount mismatch: expected ${expected}, got ${actual}`);
  }
}

export class IdempotencyConflictError extends DomainError {
  public readonly code = FailureCode.IDEMPOTENCY_CONFLICT;
  constructor(idempotencyKey: string) {
    super(
      `Idempotency key "${idempotencyKey}" already processed with a different payload`,
    );
  }
}

export class UnbalancedLedgerEntryError extends DomainError {
  public readonly code = FailureCode.INTERNAL_ERROR;
  constructor(message: string) {
    super(`Unbalanced ledger entry: ${message}`);
  }
}
