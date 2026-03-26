export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, code?: string): AppError {
    return new AppError(400, message, code);
  }

  static notFound(message: string, code?: string): AppError {
    return new AppError(404, message, code);
  }

  static internal(message: string, code?: string): AppError {
    return new AppError(500, message, code);
  }
}
