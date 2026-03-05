export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletError";
  }
}

export class WalletNotFoundError extends WalletError {
  constructor(message: string) {
    super(message);
    this.name = "WalletNotFoundError";
  }
}

export class DecryptionError extends WalletError {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}

export class InsufficientBalanceError extends WalletError {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientBalanceError";
  }
}

export class SigningError extends WalletError {
  constructor(message: string) {
    super(message);
    this.name = "SigningError";
  }
}

export class NetworkError extends WalletError {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class UnsupportedOperationError extends WalletError {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedOperationError";
  }
}
