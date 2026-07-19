import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto.js';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent on email: re-submitting updates the entry instead of erroring on
   * the unique constraint, so a user correcting a typo isn't shown a failure.
   * `walletAddress` is only ever set from a server-verified Privy session — it
   * is never taken from the request body.
   */
  async create(dto: CreateWaitlistEntryDto, walletAddress?: string) {
    const data = {
      name: dto.name,
      whatsapp: dto.whatsapp ?? null,
      tradition: dto.tradition ?? null,
      circleSize: dto.circleSize ?? null,
      trackingMethod: dto.trackingMethod ?? null,
      role: dto.role ?? null,
      wantsTryNow: dto.wantsTryNow ?? false,
      walletAddress: walletAddress ?? null,
    };

    const entry = await this.prisma.waitlistEntry.upsert({
      where: { email: dto.email },
      create: { email: dto.email, ...data },
      update: data,
    });

    this.logger.log(`waitlist entry saved: ${entry.id}`);
    return entry;
  }

  count() {
    return this.prisma.waitlistEntry.count();
  }
}
