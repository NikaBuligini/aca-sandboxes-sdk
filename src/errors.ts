export class AcaSandboxError extends Error {
  readonly statusCode: number;
  readonly responseBody: unknown;

  constructor(message: string, statusCode: number, responseBody: unknown) {
    super(message);
    this.name = 'AcaSandboxError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof AcaSandboxError && error.statusCode === 404;
}
