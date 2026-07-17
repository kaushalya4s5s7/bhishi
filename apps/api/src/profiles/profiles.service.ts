import { BadRequestException, Injectable } from '@nestjs/common';
import type { UserProfile } from '@bhishi/db';
import { PrismaService } from '../prisma/prisma.service';
import { VerifiedUser } from '../auth/privy.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent auto-provision on sign-in. Creates the profile the first time,
   * and on every call bumps lastSeenAt and back-fills email/privyUserId if Privy
   * now has them. Never overwrites a user-set displayName/avatar.
   */
  async ensure(user: VerifiedUser) {
    if (!user.walletAddress) {
      // No linked wallet yet — nothing to key a profile on. The embedded wallet
      // is usually created a moment after first login, so the client retries.
      throw new BadRequestException('No wallet linked to this account yet');
    }
    const walletAddress = user.walletAddress.toLowerCase();

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
