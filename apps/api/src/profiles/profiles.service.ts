import { BadRequestException, Injectable } from '@nestjs/common';
import type { UserProfile } from '@bhishi/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { VerifiedUser } from '../auth/privy.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent auto-provision on sign-in. Creates the profile the first time,
   * and on every call bumps lastSeenAt and back-fills email/privyUserId if Privy
   * now has them. Never overwrites a user-set displayName/avatar.
   *
   * `useMember()` (web) can resolve a DIFFERENT on-chain address for the same
   * Privy user over time — e.g. the embedded EOA before the smart account
   * finishes linking, then the smart account afterward. `privyUserId` is
   * globally unique, so upserting keyed only on `walletAddress` would try to
   * INSERT a second row with an already-claimed `privyUserId` and hit
   * P2002. Look up by `privyUserId` first and move that same row to the new
   * address instead of colliding.
   */
  async ensure(user: VerifiedUser) {
    if (!user.walletAddress) {
      // No linked wallet yet — nothing to key a profile on. The embedded wallet
      // is usually created a moment after first login, so the client retries.
      throw new BadRequestException('No wallet linked to this account yet');
    }
    const walletAddress = user.walletAddress.toLowerCase();

    const existingByPrivyId = await this.prisma.userProfile.findUnique({
      where: { privyUserId: user.userId },
    });
    if (existingByPrivyId && existingByPrivyId.walletAddress !== walletAddress) {
      // Moving `walletAddress` (the @id) means this could still collide if the
      // new address already has its own row (e.g. from a previous session on a
      // different account) — extremely unlikely, but don't 500 on it: keep
      // serving the existing row rather than losing displayName/avatar.
      const collision = await this.prisma.userProfile.findUnique({ where: { walletAddress } });
      if (!collision) {
        return this.prisma.userProfile.update({
          where: { privyUserId: user.userId },
          data: {
            walletAddress,
            lastSeenAt: new Date(),
            ...(user.email ? { email: user.email } : {}),
          },
        });
      }
      return this.prisma.userProfile.update({
        where: { walletAddress },
        data: {
          lastSeenAt: new Date(),
          privyUserId: user.userId,
          ...(user.email ? { email: user.email } : {}),
        },
      });
    }

    return this.prisma.userProfile.upsert({
      where: { walletAddress },
      create: {
        walletAddress,
        privyUserId: user.userId,
        email: user.email ?? null,
      },
      update: {
        lastSeenAt: new Date(),
        // Back-fill identity fields if they were missing before.
        privyUserId: user.userId,
        ...(user.email ? { email: user.email } : {}),
      },
    });
  }

  /** Read a profile by wallet address; returns null if none exists. */
  get(walletAddress: string): Promise<UserProfile | null> {
    return this.prisma.userProfile.findUnique({
      where: { walletAddress: walletAddress.toLowerCase() },
    });
  }

  /** Update the caller's own editable fields, provisioning the row if needed. */
  async update(user: VerifiedUser, dto: UpdateProfileDto) {
    await this.ensure(user);
    return this.prisma.userProfile.update({
      where: { walletAddress: user.walletAddress!.toLowerCase() },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
      },
    });
  }
}
