import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthedRequest, PrivyAuthGuard } from '../auth/privy-auth.guard';
import { FundCreateDto } from './dto/fund-create.dto';
import { SponsorService } from './sponsor.service';

@Controller('sponsor')
export class SponsorController {
  constructor(private readonly sponsor: SponsorService) {}

  /**
   * Top up the AUTHENTICATED user's own wallet with the exact native MON needed
   * to create a circle, so creation is gasless. The address is taken from the
   * verified Privy session — never from the request body — so a caller can only
   * ever fund themselves. Rate-limited on top of the per-user daily cap enforced
   * in the service.
   */
  @Post('create-funding')
  @UseGuards(PrivyAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async fundCreate(@Req() req: AuthedRequest, @Body() dto: FundCreateDto) {
    const wallet = req.user?.walletAddress;
    if (!wallet) {
      throw new BadRequestException('No wallet linked to this account yet');
    }
    return this.sponsor.fundCreate(wallet, dto.seats);
  }
}
