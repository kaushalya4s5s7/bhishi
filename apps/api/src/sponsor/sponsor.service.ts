import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PrismaService } from '../prisma/prisma.service.js';

// Inlined rather than imported from @bhishi/shared: that package uses JSON
// import assertions which don't compile under this API's tsconfig `module`
// setting. We only need the factory address and one view fn, so inline them.
const FACTORY_ADDRESS = '0x384597AE10181bC7215f4a57aF6caAe1a6eE26dc' as const;
const VRF_FUNDING_ABI = [
  {
    type: 'function',
    name: 'vrfFundingFor',
    stateMutability: 'view',
    inputs: [{ type: 'uint256', name: 'seats' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const MONAD_TESTNET = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
} as const;

/** Extra native token added on top of the VRF fee to cover the user's own gas
 *  for the createCircle tx (the paymaster covers UserOp gas, but a small buffer
 *  keeps EOA/edge paths working too). Intentionally small. */
const GAS_BUFFER = parseEther('0.02');

@Injectable()
export class SponsorService {
  private readonly logger = new Logger(SponsorService.name);
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient | null;
  private readonly relayerAddress: `0x${string}` | null;
  private readonly dailyCap: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const rpc = this.config.get<string>('MONAD_RPC_URL') ?? MONAD_TESTNET.rpcUrls.default.http[0];
    const chain = { ...MONAD_TESTNET, rpcUrls: { default: { http: [rpc] } } };
    this.publicClient = createPublicClient({ chain, transport: http() }) as PublicClient;
    this.dailyCap = this.config.get<number>('SPONSOR_DAILY_CAP') ?? 3;

    const pk = this.config.get<string>('RELAYER_PRIVATE_KEY');
    if (pk) {
      const account = privateKeyToAccount(pk as `0x${string}`);
      this.walletClient = createWalletClient({ account, chain, transport: http() });
      this.relayerAddress = account.address;
      this.logger.log(`sponsor relayer ready: ${account.address} (daily cap ${this.dailyCap})`);
    } else {
      this.walletClient = null;
      this.relayerAddress = null;
      this.logger.warn('RELAYER_PRIVATE_KEY unset — sponsorship disabled.');
    }
  }

  get enabled(): boolean {
    return this.walletClient !== null;
  }

  /** MON needed to fund `seats` VRF draws, per the factory quote. */
  private async vrfFundingFor(seats: number): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: FACTORY_ADDRESS,
      abi: VRF_FUNDING_ABI,
      functionName: 'vrfFundingFor',
      args: [BigInt(seats)],
    })) as bigint;
  }

  /**
   * Top up `walletAddress` with the exact native-token SHORTFALL it needs to
   * create a circle with `seats` seats (VRF funding + a gas buffer), so the
   * user's own gasless tx can then attach the value. Only ever sends to the
   * caller's OWN verified address, capped per user per day.
   */
  async fundCreate(walletAddress: string, seats: number) {
    if (!this.enabled || !this.walletClient || !this.relayerAddress) {
      throw new ServiceUnavailableException('Sponsorship is not configured');
    }
    if (!Number.isInteger(seats) || seats < 2 || seats > 20) {
      throw new BadRequestException('seats must be an integer between 2 and 20');
    }
    const to = walletAddress.toLowerCase() as `0x${string}`;

    // Per-user daily cap (anti-drain).
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const recent = await this.prisma.sponsorGrant.count({
      where: { walletAddress: to, createdAt: { gte: since }, status: 'sent' },
    });
    if (recent >= this.dailyCap) {
      throw new ForbiddenException(
        `Daily sponsorship limit reached (${this.dailyCap}/day). Try again later.`,
      );
    }

    const needed = (await this.vrfFundingFor(seats)) + GAS_BUFFER;
    const have = await this.publicClient.getBalance({ address: to });
    if (have >= needed) {
      return { funded: false, reason: 'already-funded', balance: have.toString() };
    }
    const shortfall = needed - have;

    // Guard the relayer's own balance so we fail cleanly instead of reverting.
    const relayerBal = await this.publicClient.getBalance({ address: this.relayerAddress });
    if (relayerBal < shortfall) {
      this.logger.error(`relayer ${this.relayerAddress} low: has ${relayerBal}, needs ${shortfall}`);
      throw new ServiceUnavailableException('Sponsorship temporarily unavailable — relayer low on funds');
    }

    // Record intent BEFORE sending so a crash mid-send still counts toward the
    // cap (fail safe: better to under-sponsor than to allow unbounded retries).
    const grant = await this.prisma.sponsorGrant.create({
      data: { walletAddress: to, amountWei: shortfall.toString(), status: 'pending' },
    });

    try {
      const hash = await this.walletClient.sendTransaction({
        account: this.walletClient.account!,
        chain: this.walletClient.chain,
        to,
        value: shortfall,
      });
      await this.publicClient.waitForTransactionReceipt({ hash });
      await this.prisma.sponsorGrant.update({
        where: { id: grant.id },
        data: { status: 'sent', txHash: hash },
      });
      this.logger.log(`sponsored ${shortfall} wei to ${to} (tx ${hash})`);
      return { funded: true, txHash: hash, amountWei: shortfall.toString() };
    } catch (err) {
      await this.prisma.sponsorGrant.update({
        where: { id: grant.id },
        data: { status: 'failed' },
      });
      this.logger.error(`sponsor send failed for ${to}: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Sponsorship transaction failed');
    }
  }
}
