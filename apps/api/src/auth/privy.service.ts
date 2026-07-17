import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';

export interface VerifiedUser {
  /** Privy DID, e.g. did:privy:xxx */
  userId: string;
  /** The user's on-chain wallet address (lowercased), if Privy has one linked. */
  walletAddress?: string;
  /** The user's verified email, if linked. */
  email?: string;
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
    let userId: string;
    try {
      const claims = await this.client.verifyAuthToken(token);
      userId = claims.userId;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // The access-token claims carry only the DID. Resolve the linked wallet and
    // email from Privy so callers (waitlist, profiles) key off the real on-chain
    // address rather than the DID. Best-effort: a lookup failure still yields a
    // valid identity, just without the extra fields.
    try {
      const user = await this.client.getUser(userId);
      const accounts = (user.linkedAccounts ?? []) as unknown as Array<Record<string, unknown>>;
      // MUST match the frontend's useMember() identity choice: prefer the smart
      // account (ERC-4337) when one exists, else the embedded EOA. If these
      // disagree, the relayer funds one address while createCircle runs from the
      // other — which is exactly the "topped up but still 0 balance" revert.
      const smart = accounts.find((a) => a.type === 'smart_wallet');
      const embedded = accounts.find((a) => a.type === 'wallet');
      const primary = smart ?? embedded;
      const email = accounts.find((a) => a.type === 'email');
      return {
        userId,
        walletAddress:
          typeof primary?.address === 'string' ? primary.address.toLowerCase() : undefined,
        email: typeof email?.address === 'string' ? email.address : undefined,
      };
    } catch (err) {
      this.logger.warn(`getUser failed for ${userId}: ${(err as Error).message}`);
      return { userId };
    }
  }
}
