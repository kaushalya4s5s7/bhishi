import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PrivyService, VerifiedUser } from './privy.service.js';

export interface AuthedRequest extends Request {
  user?: VerifiedUser;
}

function bearerFrom(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** Requires a valid Privy token; attaches `req.user`. */
@Injectable()
export class PrivyAuthGuard implements CanActivate {
  constructor(private readonly privy: PrivyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerFrom(req);
    if (!token) throw new UnauthorizedException('Missing bearer token');
    req.user = await this.privy.verify(token);
    return true;
  }
}

/**
 * Attaches `req.user` when a valid token is present but never rejects.
 * Used by the waitlist so anonymous submissions still work while
 * authenticated ones get a verified identity attached.
 */
@Injectable()
export class OptionalPrivyAuthGuard implements CanActivate {
  constructor(private readonly privy: PrivyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerFrom(req);
    if (token && this.privy.configured) {
      try {
        req.user = await this.privy.verify(token);
      } catch {
        // Ignore: an invalid token is treated as anonymous here, not an error.
      }
    }
    return true;
  }
}
