import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SaveSubscriptionDto } from './dto/save-subscription.dto.js';

@Injectable()
export class PushService {
  constructor(private readonly prisma: PrismaService) {}

  /** Upsert on endpoint so re-subscribing (e.g. same device, refreshed key) never errors. */
  save(walletAddress: string, dto: SaveSubscriptionDto) {
    const data = {
      walletAddress: walletAddress.toLowerCase(),
      p256dh: dto.p256dh,
      auth: dto.auth,
    };
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { endpoint: dto.endpoint, ...data },
      update: data,
    });
  }

  async remove(endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return { ok: true };
  }
}
