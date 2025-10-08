/**
 * Custom error classes for the application
 */

export class NotFoundError extends Error {
  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string = 'Validation failed') {
    super(message);
    this.name = 'ValidationError';
  }
}

export class StorageQuotaError extends Error {
  constructor(message: string = 'Storage quota exceeded') {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

export class PermissionDeniedError extends Error {
  constructor(message: string = 'Permission denied') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export class NotSupportedError extends Error {
  constructor(message: string = 'Feature not supported') {
    super(message);
    this.name = 'NotSupportedError';
  }
}

export class DuplicateWarning extends Error {
  constructor(message: string = 'Duplicate entry detected') {
    super(message);
    this.name = 'DuplicateWarning';
  }
}

export class InvalidCredentialsError extends Error {
  constructor(message: string = 'Invalid credentials') {
    super(message);
    this.name = 'InvalidCredentialsError';
  }
}

export class AlreadyExistsError extends Error {
  constructor(message: string = 'Resource already exists') {
    super(message);
    this.name = 'AlreadyExistsError';
  }
}

export class SessionExpiredError extends Error {
  constructor(message: string = 'Session expired') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class NotAuthenticatedError extends Error {
  constructor(message: string = 'Not authenticated') {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}

export class ConfirmationError extends Error {
  constructor(message: string = 'Confirmation required') {
    super(message);
    this.name = 'ConfirmationError';
  }
}
