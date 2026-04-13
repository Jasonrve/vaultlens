import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import type { AuthenticatedRequest } from '../types/index.js';

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit cookie CSRF protection.
 *
 * On every authenticated response, a random CSRF token is set as a non-httpOnly
 * cookie (readable by JS). State-changing requests (POST, PUT, DELETE) must echo
 * the token back in the X-CSRF-Token header. Because a cross-origin attacker
 * cannot read cookies from another domain, they cannot forge the header.
 */
export function csrfProtection(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  // Ensure a CSRF cookie exists — set one if missing
  let cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;
  if (!cookieToken) {
    cookieToken = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, cookieToken, {
      httpOnly: false, // JS must be able to read it
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/',
    });
  }

  // Safe methods don't need CSRF validation
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (safeMethod) {
    next();
    return;
  }

  // Validate: the header must match the cookie
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;
  if (!headerToken || headerToken !== cookieToken) {
    res.status(403).json({ error: 'CSRF token mismatch' });
    return;
  }

  next();
}
