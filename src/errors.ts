export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'QUEUE_FULL'
  | 'TIMEOUT'
  | 'SELECTOR_NOT_FOUND'
  | 'BROWSER_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public details?: Record<string, unknown>;

  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.details = details;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
