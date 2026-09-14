import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

interface AuthTokenPayload {
  sub: string;
  email: string;
}

function isAuthTokenPayload(payload: unknown): payload is AuthTokenPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).sub === 'string' &&
    typeof (payload as Record<string, unknown>).email === 'string'
  );
}

/**
 * Verifies the shared JWT (signed with the same secret as Onboard) and attaches the
 * authenticated user's identity to the request. Does not itself authorize any org or role —
 * see orgScope.middleware for that.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (!isAuthTokenPayload(payload)) {
      res.status(401).json({ error: 'Invalid token payload' });
      return;
    }
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
