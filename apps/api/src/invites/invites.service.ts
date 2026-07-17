import { randomBytes } from 'node:crypto';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateInvitesDto } from './dto/create-invites.dto';

type InvalidReason = 'unknown' | 'revoked' | 'full';

export interface ValidateResult {
  valid: boolean;
  circleAddress?: string;
  kind?: 'LINK' | 'EMAIL';
  status?: string;
  reason?: InvalidReason;
}

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  private webUrl(): string {
    return (this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  private buildUrl(circleAddress: string, token: string): string {
    return `${this.webUrl()}/circle/${circleAddress}?invite=${token}`;
  }

  private newToken(): string {
    return randomBytes(24).toString('base64url');
  }

  /**
   * Mint invites for a circle. Only the circle's creator may call this. Always
   * ensures a reusable LINK token exists (idempotent), and mints one EMAIL token
   * per address, sending each email best-effort. Circle addresses are lowercased
   * to match the indexed rows and the on-chain identity used everywhere.
   */
  async createInvites(dto: CreateInvitesDto, caller: string) {
    const circleAddress = dto.circleAddress.toLowerCase();
    const callerAddr = caller.toLowerCase();

    const circle = await this.prisma.circle.findUnique({ where: { address: circleAddress } });
    if (!circle || circle.creator.toLowerCase() !== callerAddr) {
      throw new ForbiddenException('Only the circle creator can send invites');
    }

    let link = await this.prisma.invite.findFirst({ where: { circleAddress, kind: 'LINK' } });
    if (!link) {
      link = await this.prisma.invite.create({
        data: { token: this.newToken(), circleAddress, kind: 'LINK', invitedBy: callerAddr },
      });
    }

    const emails = dto.emails ?? [];
    const invited: { email: string; url: string }[] = [];
    for (const raw of emails) {
      const email = raw.trim().toLowerCase();
      if (!email) continue;
      let row = await this.prisma.invite.findFirst({ where: { circleAddress, kind: 'EMAIL', email } });
      if (!row) {
        row = await this.prisma.invite.create({
          data: { token: this.newToken(), circleAddress, kind: 'EMAIL', email, invitedBy: callerAddr },
        });
      }
      const url = this.buildUrl(circleAddress, row.token);
      await this.email.sendCircleInvite({ to: email, circleAddress, inviteUrl: url, inviter: callerAddr });
      invited.push({ email, url });
    }

    return { linkUrl: this.buildUrl(circleAddress, link.token), invited };
  }

  /**
   * Resolve a token for the frontend gate. Validity is capacity-bounded: the
   * token is only valid while the circle still has open seats AND is FILLING.
   * memberCount/seats come from the indexed rows, so this stays correct even for
   * a direct on-chain join.
   */
  async validate(token: string): Promise<ValidateResult> {
    const invite = await this.prisma.invite.findUnique({ where: { token } });
    if (!invite) return { valid: false, reason: 'unknown' };
    if (invite.status === 'REVOKED') {
      return { valid: false, reason: 'revoked', circleAddress: invite.circleAddress, kind: invite.kind };
    }

    const circle = await this.prisma.circle.findUnique({ where: { address: invite.circleAddress } });
    const memberCount = await this.prisma.member.count({ where: { circleAddress: invite.circleAddress } });
    const full = !circle || circle.state !== 'FILLING' || memberCount >= circle.seats;
    if (full) {
      return { valid: false, reason: 'full', circleAddress: invite.circleAddress, kind: invite.kind };
    }

    return { valid: true, circleAddress: invite.circleAddress, kind: invite.kind, status: invite.status };
  }

  /**
   * Best-effort attribution: mark the token CONSUMED and record who joined.
   * Never throws on business conditions — a failed consume must not block a join
   * that already succeeded on-chain.
   */
  async consume(token: string, joiner: string): Promise<void> {
    try {
      const invite = await this.prisma.invite.findUnique({ where: { token } });
      if (!invite) return;
      if (invite.kind === 'EMAIL' && invite.status === 'CONSUMED') return;
      const alreadyAttributed = invite.consumedBy != null;
      await this.prisma.invite.update({
        where: { token },
        data: {
          status: invite.kind === 'EMAIL' ? 'CONSUMED' : invite.status,
          consumedBy: alreadyAttributed ? invite.consumedBy : joiner.toLowerCase(),
          consumedAt: alreadyAttributed ? invite.consumedAt : new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(`consume(${token}) failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
