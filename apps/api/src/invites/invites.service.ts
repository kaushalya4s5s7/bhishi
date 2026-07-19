import { randomBytes } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, type PublicClient } from 'viem';
import { circleAbi, circleFactoryAbi, addresses } from '@bhishi/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { CreateInvitesDto } from './dto/create-invites.dto.js';

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
  private readonly publicClient: PublicClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {
    const rpcUrl = this.config.get<string>('MONAD_RPC_URL') ?? 'https://testnet-rpc.monad.xyz';
    this.publicClient = createPublicClient({
      chain: {
        id: 10143,
        name: 'Monad Testnet',
        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      },
      transport: http(rpcUrl),
    }) as PublicClient;
  }

  /**
   * Materialize a circle's row straight from chain when the indexer hasn't
   * written it yet. The invite link only needs {circleAddress, creator}, and
   * both are known on chain the instant createCircle mines — so there's no
   * reason to wait on the indexer. Verifies the address is a real
   * factory-deployed circle (isCircle) before trusting its getters, so a random
   * contract can't be passed off as a circle, then reads the FULL config
   * (creator/seats/bond/contribution/mode/state) and upserts a row so the
   * Invite FK is satisfied. The indexer later reconciles the same row
   * idempotently (upsert on the same address). Returns the lowercased creator,
   * or null if the address isn't a circle this factory made (or a read fails).
   */
  private async ensureCircleFromChain(circleAddress: string): Promise<string | null> {
    try {
      const isCircle = (await this.publicClient.readContract({
        address: addresses.monadTestnet.factory,
        abi: circleFactoryAbi as never,
        functionName: 'isCircle',
        args: [circleAddress as `0x${string}`],
      })) as boolean;
      if (!isCircle) return null;

      const addr = circleAddress as `0x${string}`;
      const [creator, seats, bond, contribution, mode, state] = (await Promise.all([
        this.publicClient.readContract({ address: addr, abi: circleAbi as never, functionName: 'creator' }),
        this.publicClient.readContract({ address: addr, abi: circleAbi as never, functionName: 'seats' }),
        this.publicClient.readContract({ address: addr, abi: circleAbi as never, functionName: 'bond' }),
        this.publicClient.readContract({ address: addr, abi: circleAbi as never, functionName: 'contribution' }),
        this.publicClient.readContract({ address: addr, abi: circleAbi as never, functionName: 'mode' }),
        this.publicClient.readContract({ address: addr, abi: circleAbi as never, functionName: 'state' }),
      ])) as [string, bigint, bigint, bigint, number, number];

      const creatorLc = creator.toLowerCase();
      // Write the REAL config, not placeholders — a seats=0 row would make every
      // invite report the circle "full" (validate() computes memberCount >= seats).
      // lastIndexedBlock stays 0 so the indexer still backfills per-event history.
      await this.prisma.circle.upsert({
        where: { address: circleAddress },
        create: {
          address: circleAddress,
          factoryTx: '', // unknown here; the indexer fills the authoritative value
          creator: creatorLc,
          seats: Number(seats),
          contribution: contribution.toString(),
          bond: bond.toString(),
          mode: Number(mode) === 1 ? 'AUCTION' : 'LUCKY_DRAW',
          state: ['FILLING', 'ACTIVE', 'ABORTED_FILLING', 'COMMIT', 'REVEAL', 'DRAW', 'PAYOUT', 'COMPLETED', 'STALLED'][Number(state)] as never,
          createdAt: new Date(),
          lastIndexedBlock: 0n,
        },
        update: {},
      });
      this.logger.log({ circleAddress, creator: creatorLc }, 'createInvites: materialized circle row from chain');
      return creatorLc;
    } catch (err) {
      this.logger.warn(
        { circleAddress, err: (err as Error).message },
        'ensureCircleFromChain: on-chain read failed',
      );
      return null;
    }
  }

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
    // The invite link only needs {circleAddress, creator}, and both are known on
    // chain the instant createCircle mines. So DON'T block on the indexer: if the
    // row isn't there yet, read the creator straight from the contract. This lets
    // the creator get their link INSTANTLY after creating, no polling/retry.
    const creator = circle
      ? circle.creator.toLowerCase()
      : await this.ensureCircleFromChain(circleAddress);

    if (!creator) {
      // Not indexed AND not a factory-deployed circle on chain (or the RPC read
      // failed). 409, not 403: a genuinely-just-created circle resolves via the
      // chain read above, so reaching here is either a bad address or a transient
      // RPC hiccup — retryable, not an authorization failure.
      this.logger.warn(
        { circleAddress, callerAddr },
        'createInvites: circle not indexed and not resolvable on-chain (retryable)',
      );
      throw new ConflictException('Circle not found yet — try again in a moment');
    }
    if (creator !== callerAddr) {
      this.logger.warn(
        { circleAddress, creator, callerAddr, source: circle ? 'indexed' : 'chain' },
        'createInvites: caller is not the creator',
      );
      throw new ForbiddenException('Only the circle creator can send invites');
    }

    // '' is the sentinel email for LINK invites — see schema.prisma for why NULL
    // can't be used to dedupe. upsert() on the (circleAddress, kind, email)
    // unique constraint makes concurrent createInvites calls converge on the
    // same row instead of racing to create duplicates.
    const link = await this.prisma.invite.upsert({
      where: { circleAddress_kind_email: { circleAddress, kind: 'LINK', email: '' } },
      update: {},
      create: { token: this.newToken(), circleAddress, kind: 'LINK', email: '', invitedBy: callerAddr },
    });

    const emails = dto.emails ?? [];
    const uniqueEmails = [...new Set(emails.map(raw => raw.trim().toLowerCase()).filter(Boolean))];
    const invited: { email: string; url: string }[] = [];
    const failed: string[] = [];
    for (const email of uniqueEmails) {
      const row = await this.prisma.invite.upsert({
        where: { circleAddress_kind_email: { circleAddress, kind: 'EMAIL', email } },
        update: {},
        create: { token: this.newToken(), circleAddress, kind: 'EMAIL', email, invitedBy: callerAddr },
      });
      const url = this.buildUrl(circleAddress, row.token);
      // Only report an email as "invited" if it was actually delivered — the
      // invite token itself is still minted either way, so the link keeps
      // working even if the email bounced.
      const sent = await this.email.sendCircleInvite({ to: email, circleAddress, inviteUrl: url, inviter: callerAddr });
      if (sent) invited.push({ email, url });
      else failed.push(email);
    }

    return { linkUrl: this.buildUrl(circleAddress, link.token), invited, failed };
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
    // Row missing (indexer still catching up) or seats not yet reconciled:
    // don't falsely report "full" — memberCount >= 0 is vacuously true against
    // a seats=0 placeholder, and `!circle` says nothing about capacity. The
    // real gate is on-chain join() either way; this check is only a courtesy.
    if (!circle || circle.seats === 0) {
      return { valid: true, circleAddress: invite.circleAddress, kind: invite.kind, status: invite.status };
    }
    const memberCount = await this.prisma.member.count({ where: { circleAddress: invite.circleAddress } });
    const full = circle.state !== 'FILLING' || memberCount >= circle.seats;
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
