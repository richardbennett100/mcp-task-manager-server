export class AppError extends Error {
  public readonly errorCode: string;
  public readonly statusCode: number;
  public readonly details: any;

  constructor(errorCode: string, message: string, statusCode: number, details?: any) {
    super(message);
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const ErrorCode = {
  BadRequest: 'BadRequest',
  Unauthorized: 'Unauthorized',
  Forbidden: 'Forbidden',
  NotFound: 'NotFound',
  Conflict: 'Conflict',
  InternalServerError: 'InternalServerError',
  DatabaseError: 'DatabaseError',
  ValidationError: 'ValidationError',
  ApiError: 'ApiError',
};

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: any) {
    super(ErrorCode.NotFound, message, 404, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: any) {
    super(ErrorCode.ValidationError, message, 400, details);
  }
}

export class DatabaseError extends AppError {
  constructor(message = 'A database error occurred', details?: any) {
    super(ErrorCode.DatabaseError, message, 500, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details?: any) {
    super(ErrorCode.Unauthorized, message, 401, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: any) {
    super(ErrorCode.Forbidden, message, 403, details);
  }
}
