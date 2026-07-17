import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';

export interface VerifiedUser {
  /** Privy DID, e.g. did:privy:xxx */
  userId: string;
}

/**
 * Verifies Privy-issued access tokens server-side. Until this existed, the app
 * trusted whatever the browser claimed (e.g. the waitlist route accepted any
 * posted email as "verified via sign-in") — this closes that hole.
 */
@Injectable()
export class PrivyService {
  private readonly logger = new Logger(PrivyService.name);
  private readonly client: PrivyClient | null;

  constructor(private readonly config: ConfigService) {
    const appId = this.config.get<string>('PRIVY_APP_ID');
    const appSecret = this.config.get<string>('PRIVY_APP_SECRET');
    if (!appId || !appSecret) {
      this.logger.warn(
        'PRIVY_APP_ID/PRIVY_APP_SECRET unset — auth-protected routes will reject all requests.',
      );
      this.client = null;
    } else {
      this.client = new PrivyClient(appId, appSecret);
    }
  }

  get configured(): boolean {
    return this.client !== null;
  }

  /** Throws UnauthorizedException unless the token verifies. */
  async verify(token: string): Promise<VerifiedUser> {
    if (!this.client) throw new UnauthorizedException('Auth not configured');
    try {
      const claims = await this.client.verifyAuthToken(token);
      return { userId: claims.userId };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
