import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_EXPIRES_IN, JWT_SECRET } from "../config.js";
import { unauthorized } from "../utils/http.js";

/** What we store inside the token. Keep it small, it travels on every request. */
export interface TokenPayload {
  donorId: string;
  phone: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

/**
 * Express does not know about our extra property, so we declare it. After
 * requireAuth has run, request.donor is always set.
 */
declare module "express-serve-static-core" {
  interface Request {
    donor?: TokenPayload;
  }
}

function readToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/** Blocks the request when there is no valid token. */
export function requireAuth(request: Request, _response: Response, next: NextFunction): void {
  const token = readToken(request);
  if (!token) {
    next(unauthorized());
    return;
  }

  try {
    request.donor = jwt.verify(token, JWT_SECRET) as TokenPayload;
    next();
  } catch {
    next(unauthorized("Your session has expired. Please log in again."));
  }
}

/** Fills in request.donor when a token is present, but never blocks. */
export function optionalAuth(request: Request, _response: Response, next: NextFunction): void {
  const token = readToken(request);
  if (token) {
    try {
      request.donor = jwt.verify(token, JWT_SECRET) as TokenPayload;
    } catch {
      // An invalid token on a public route is simply ignored.
    }
  }
  next();
}

/** For routes where a donor may only touch their own record. */
export function requireSelf(request: Request, donorId: string): void {
  if (!request.donor || request.donor.donorId !== donorId) {
    throw unauthorized("You can only change your own profile.");
  }
}
