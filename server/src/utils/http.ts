import type { NextFunction, Request, Response } from "express";

/**
 * An error that already knows which HTTP status it should produce. Routes throw
 * these, the error handler at the bottom of index.ts turns them into JSON.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export const badRequest = (message: string) => new ApiError(400, message);
export const unauthorized = (message = "You need to log in first.") => new ApiError(401, message);
export const forbidden = (message = "You cannot change this record.") => new ApiError(403, message);
export const notFound = (message = "Not found.") => new ApiError(404, message);
export const conflict = (message: string) => new ApiError(409, message);

type Handler = (request: Request, response: Response, next: NextFunction) => Promise<unknown>;

/**
 * Express 4 does not catch rejected promises by itself, so every async route is
 * wrapped in this helper. Without it a failed database call would hang the
 * request instead of returning a 500.
 */
export function asyncRoute(handler: Handler) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next);
  };
}
