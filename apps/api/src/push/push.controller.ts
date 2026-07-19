import { Body, Controller, Delete, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthedRequest, PrivyAuthGuard } from '../auth/privy-auth.guard.js';
import { SaveSubscriptionDto } from './dto/save-subscription.dto.js';
import { PushService } from './push.service.js';

@Controller('push')
@UseGuards(PrivyAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('subscribe')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  subscribe(@Body() dto: SaveSubscriptionDto, @Req() req: AuthedRequest) {
    return this.push.save(req.user!.walletAddress!, dto);
  }

  @Delete('subscribe')
  // Not wallet-scoped by design: the guard just rejects anonymous callers.
  // `endpoint` is a hard-to-guess push-service URL only the subscribing
  // browser knows, so deleting by it alone is safe without an ownership check.
  unsubscribe(@Body() dto: SaveSubscriptionDto) {
    return this.push.remove(dto.endpoint);
  }
}
