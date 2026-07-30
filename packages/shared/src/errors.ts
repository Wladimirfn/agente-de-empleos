export class AppError extends Error {
  readonly code: string;
  constructor(message: string, code = 'APP_ERROR') {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
