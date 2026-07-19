import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthedRequest, OptionalPrivyAuthGuard } from '../auth/privy-auth.guard.js';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto.js';
import { WaitlistService } from './waitlist.service.js';

@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  /**
   * Public intake — anonymous submissions are allowed, but if a valid Privy
   * token is present we attach the verified identity. Rate-limited because it's
   * an unauthenticated write endpoint.
   */
  @Post()
  @UseGuards(OptionalPrivyAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async create(@Body() dto: CreateWaitlistEntryDto, @Req() req: AuthedRequest) {
    // Bind the server-verified wallet address (not the request body, and not the
    // Privy DID) so the notify worker can match on-chain members to their contact.
    const entry = await this.waitlist.create(dto, req.user?.walletAddress);
    return { ok: true, id: entry.id };
  }

  /** Public feed for the landing page's community carousel — see
   *  WaitlistService.listForCarousel for exactly which fields are exposed. */
  @Get('carousel')
  list(@Query('take') take?: string) {
    return this.waitlist.listForCarousel(take ? Number(take) : undefined);
  }
}
