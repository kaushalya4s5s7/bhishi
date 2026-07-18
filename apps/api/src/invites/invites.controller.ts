import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthedRequest, PrivyAuthGuard } from '../auth/privy-auth.guard';
import { CreateInvitesDto } from './dto/create-invites.dto';
import { InvitesService } from './invites.service';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /** Mint the reusable LINK + per-email tokens and send the emails. Creator-only:
   *  the wallet is read from the verified session, never the body. */
  @Post()
  @UseGuards(PrivyAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(@Req() req: AuthedRequest, @Body() dto: CreateInvitesDto) {
    const wallet = req.user?.walletAddress;
    if (!wallet) throw new BadRequestException('No wallet linked to this account yet');
    return this.invites.createInvites(dto, wallet);
  }

  /** Public: resolve a token so the frontend gate knows where to route. */
  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  validate(@Param('token') token: string) {
    return this.invites.validate(token);
  }

  /** Attribution after a successful join. Authenticated so we trust the joiner. */
  @Post(':token/consume')
  @UseGuards(PrivyAuthGuard)
  async consume(@Req() req: AuthedRequest, @Param('token') token: string) {
    const wallet = req.user?.walletAddress;
    if (!wallet) throw new BadRequestException('No wallet linked to this account yet');
    await this.invites.consume(token, wallet);
    return { ok: true };
  }
}
