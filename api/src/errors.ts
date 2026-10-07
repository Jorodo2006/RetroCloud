export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
export const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'Valid credentials required');
export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Resource not found');
export function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
