import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, parseAbiItem, parseEventLogs, type Log, type PublicClient } from 'viem';
import { circleAbi, addresses } from '@bhishi/shared';
import { prisma } from '@bhishi/db';
import { ConfirmableAction } from './dto/confirm-transaction.dto.js';

type AnyLog = Log & { eventName?: string; args?: Record<string, unknown> };

/** Mirrors apps/workers/src/indexer/sync.ts's circleCreatedEvent — kept as a
 *  local copy rather than a cross-app import (apps/api must not depend on
 *  apps/workers). Keep both definitions in sync if the event signature ever
 *  changes. */
const circleCreatedEvent = parseAbiItem(
  'event CircleCreated(address indexed circle, address indexed creator, uint256 contribution, uint256 seats, uint256 bond, uint8 mode)',
);

/**
 * Verified fast-path: after a user's OWN wallet confirms a join/commit/reveal/
 * createCircle transaction, the frontend calls this with just the txHash so
 * the dashboard/circle page reflect it immediately, instead of waiting for the
 * indexer's next poll (which can lag by up to POLL_INTERVAL_MS).
 *
 * This does NOT replace the indexer — it stays the sole source of truth for
 * everyone else's activity (other wallets, direct contract calls, bots), and
 * it independently re-applies the same event on its next pass anyway, since
 * every write here is idempotent (upsert on the same unique keys the indexer
 * uses). This endpoint is purely a UX latency shortcut for the caller's own
 * action, never a parallel or trusted write path: the ONLY client input used
 * is the tx hash — everything else (success, logs, args) is re-derived
 * directly from the chain via getTransactionReceipt + parseEventLogs, mirroring
 * apps/workers/src/indexer/sync.ts's applyEvent(). Keep both in sync if the
 * contract's event set changes.
 */
@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly publicClient: PublicClient;

  constructor(private readonly config: ConfigService) {
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

  async confirm(txHash: `0x${string}`, action: ConfirmableAction, callerAddress: string) {
    const receipt = await this.publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
    if (!receipt) throw new NotFoundException('Transaction not found (not yet mined, or wrong network)');
    if (receipt.status !== 'success') throw new BadRequestException('Transaction did not succeed on-chain');

    // Authentication note: for a plain EOA tx, receipt.from IS the caller. But
    // the app's primary path is gasless ERC-4337 — there the mined tx is sent
    // by the BUNDLER to the ENTRYPOINT, so receipt.from/receipt.to say nothing
    // about the user. Instead each handler authenticates against the decoded
    // event's subject (creator/member), which the contract derived from
    // msg.sender — that's the caller's smart account and can't be spoofed via
    // someone else's tx hash.
    const senderIsCaller = receipt.from.toLowerCase() === callerAddress.toLowerCase();

    if (action === 'createCircle') return this.confirmCreateCircle(receipt, callerAddress, senderIsCaller);
    return this.confirmCircleAction(receipt, action, callerAddress, senderIsCaller);
  }

  private async confirmCreateCircle(
    receipt: {
      to: string | null;
      logs: Log[];
      blockNumber: bigint;
      transactionHash: string;
    },
    callerAddress: string,
    senderIsCaller: boolean,
  ) {
    const factory = addresses.monadTestnet.factory.toLowerCase();

    // Find the CircleCreated event emitted BY the factory. receipt.to can't be
    // used here: for a UserOp it's the EntryPoint, not the factory. The log's
    // emitting address is the trustworthy anchor either way.
    const created = (parseEventLogs({ abi: [circleCreatedEvent], logs: receipt.logs }) as unknown as AnyLog[]).find(
      (l) => l.address.toLowerCase() === factory,
    ) as (AnyLog & { args: { circle?: `0x${string}`; creator?: `0x${string}` } }) | undefined;
    if (!created?.args.circle) {
      throw new BadRequestException('No CircleCreated event from the CircleFactory in this transaction');
    }

    const circleAddress = created.args.circle.toLowerCase();
    const creator = (created.args.creator ?? '0x').toLowerCase();

    // The event's creator is the factory's msg.sender — for a UserOp that's
    // the user's smart account even though receipt.from is the bundler.
    if (!senderIsCaller && creator !== callerAddress.toLowerCase()) {
      throw new BadRequestException('Transaction was not sent by the authenticated caller');
    }

    const existing = await prisma.circle.findUnique({ where: { address: circleAddress } });
    if (existing) return { applied: false, reason: 'already-indexed', circleAddress };

    // Best-effort only: decode what we can here so the row EXISTS immediately
    // (the creator's dashboard needs that), but leave lastIndexedBlock at 0 so
    // the indexer's next pass is guaranteed to reconcile exact contribution/
    // seats/bond/mode values authoritatively rather than trusting a partial
    // fast-path guess.
    const block = await this.publicClient.getBlock({ blockNumber: receipt.blockNumber });
    await prisma.circle.upsert({
      where: { address: circleAddress },
      create: {
        address: circleAddress,
        factoryTx: receipt.transactionHash,
        creator,
        seats: 0,
        contribution: '0',
        bond: '0',
        mode: 'LUCKY_DRAW',
        createdAt: new Date(Number(block.timestamp) * 1000),
        lastIndexedBlock: 0n,
      },
      update: {},
    });
    this.logger.log({ circleAddress, creator }, 'fast-path: circle row created, awaiting indexer reconciliation');
    return { applied: true, circleAddress };
  }

  private async confirmCircleAction(
    receipt: { to: string | null; logs: Log[] },
    action: Extract<ConfirmableAction, 'join' | 'commit' | 'reveal'>,
    callerAddress: string,
    senderIsCaller: boolean,
  ) {
    const decoded = parseEventLogs({ abi: circleAbi, logs: receipt.logs }) as unknown as AnyLog[];
    const wantEvent = action === 'join' ? 'Joined' : action === 'commit' ? 'Committed' : 'Revealed';
    // receipt.to is the EntryPoint for UserOps, so the circle's address comes
    // from the event log's emitting contract, and the caller is authenticated
    // as the event's member (msg.sender inside the circle).
    const match = decoded.find(
      (l) =>
        l.eventName === wantEvent &&
        (senderIsCaller ||
          (typeof (l.args as Record<string, unknown> | undefined)?.member === 'string' &&
            ((l.args as Record<string, unknown>).member as string).toLowerCase() === callerAddress.toLowerCase())),
    );
    if (!match) throw new BadRequestException(`No ${wantEvent} event for the authenticated caller in this transaction's logs`);

    const circleAddress = match.address.toLowerCase();
    const circle = await prisma.circle.findUnique({ where: { address: circleAddress } });
    if (!circle) throw new NotFoundException('Circle not indexed yet — try again shortly');

    const args = match.args as Record<string, unknown>;
    const member = typeof args.member === 'string' ? args.member.toLowerCase() : undefined;
    if (!member) throw new BadRequestException('Could not decode member address from event');

    if (action === 'join') {
      await prisma.member.upsert({
        where: { circleAddress_address: { circleAddress, address: member } },
        create: { circleAddress, address: member, joinedAt: new Date() },
        update: {},
      });
    }
    // Committed/Revealed don't have a derived row today (mirroring sync.ts's
    // applyEvent default case) — they're just visible via ChainEvent once the
    // indexer catches up. The fast path's job here is only to unblock "am I
    // a member yet" for the dashboard immediately after joining.

    this.logger.log({ circleAddress, member, action }, 'fast-path: applied');
    return { applied: true, circleAddress, action };
  }
}
