export class WalletError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WalletError'
  }
}

export class WalletNotFoundError extends WalletError {
  constructor(message: string) {
    super(message)
    this.name = 'WalletNotFoundError'
  }
}

export class DecryptionError extends WalletError {
  constructor(message: string) {
    super(message)
    this.name = 'DecryptionError'
  }
}

export class InsufficientBalanceError extends WalletError {
  constructor(message: string) {
    super(message)
    this.name = 'InsufficientBalanceError'
  }
}

export class SigningError extends WalletError {
  constructor(message: string) {
    super(message)
    this.name = 'SigningError'
  }
}

export class NetworkError extends WalletError {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

export class UnsupportedOperationError extends WalletError {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedOperationError'
  }
}

// ---------------------------------------------------------------------------
// External signer error hierarchy — shared base for wallet-cli and future
// external signing backends (other WaaS, hardware wallets, other CLIs).
// Callers can catch by category (config/execution/usage/not-found) rather
// than enumerating per-backend classes.
// ---------------------------------------------------------------------------

export class ExternalSignerError extends WalletError {
  constructor(message: string) {
    super(message)
    this.name = 'ExternalSignerError'
  }
}

export class ExternalSignerConfigError extends ExternalSignerError {
  constructor(message: string) {
    super(message)
    this.name = 'ExternalSignerConfigError'
  }
}

export class ExternalSignerExecutionError extends ExternalSignerError {
  readonly code: string
  constructor(message: string, code: string = 'execution_error') {
    super(message)
    this.name = 'ExternalSignerExecutionError'
    this.code = code
  }
}

export class ExternalSignerUsageError extends ExternalSignerError {
  readonly code: string
  constructor(message: string, code: string = 'usage_error') {
    super(message)
    this.name = 'ExternalSignerUsageError'
    this.code = code
  }
}

export class ExternalSignerNotFoundError extends ExternalSignerError {
  constructor(message: string) {
    super(message)
    this.name = 'ExternalSignerNotFoundError'
  }
}

// ---------------------------------------------------------------------------
// Privy errors — retrofitted to extend the shared hierarchy (additive:
// all instanceof WalletError checks remain valid).
// ---------------------------------------------------------------------------

export class PrivyConfigError extends ExternalSignerConfigError {
  constructor(message: string) {
    super(message)
    this.name = 'PrivyConfigError'
  }
}

export class PrivyRequestError extends ExternalSignerExecutionError {
  constructor(message: string) {
    super(message)
    this.name = 'PrivyRequestError'
  }
}

export class PrivyRateLimitError extends ExternalSignerExecutionError {
  constructor(message: string) {
    super(message)
    this.name = 'PrivyRateLimitError'
  }
}

export class PrivyAuthError extends ExternalSignerExecutionError {
  constructor(message: string) {
    super(message)
    this.name = 'PrivyAuthError'
  }
}

// ---------------------------------------------------------------------------
// Wallet-cli specific errors — extend shared hierarchy.
// ---------------------------------------------------------------------------

export class WalletCliConfigError extends ExternalSignerConfigError {
  constructor(message: string) {
    super(message)
    this.name = 'WalletCliConfigError'
  }
}

export class WalletCliExecutionError extends ExternalSignerExecutionError {
  constructor(message: string, code: string) {
    super(message, code)
    this.name = 'WalletCliExecutionError'
  }
}

export class WalletCliUsageError extends ExternalSignerUsageError {
  constructor(message: string, code: string) {
    super(message, code)
    this.name = 'WalletCliUsageError'
  }
}

export class WalletCliNotFoundError extends ExternalSignerNotFoundError {
  constructor(message: string) {
    super(message)
    this.name = 'WalletCliNotFoundError'
  }
}
