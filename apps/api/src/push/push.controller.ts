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
  unsubscribe(@Body() dto: SaveSubscriptionDto) {
    return this.push.remove(dto.endpoint);
  }
}
