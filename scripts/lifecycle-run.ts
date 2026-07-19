#!/usr/bin/env node
/**
 * Bhishi live lifecycle runner — drives a full 3-seat, 3-round circle
 * end-to-end on Monad testnet against the CURRENT deployed contracts
 * (packages/shared/src/addresses.ts), in either AUCTION or LUCKY_DRAW mode.
 *
 * Every commit/reveal/draw/claim is a REAL transaction, and every draw is
 * fulfilled by Pyth Entropy's keeper (not self-delivered) — requestDraw()
 * pays the real Entropy fee from the circle's own MON balance, then this
 * script POLLS chain state until the keeper's callback lands.
 *
 * Verifies the conservation invariant on-chain after every round:
 *   balance == totalClaimable + dustAccrued + undrawnPools + totalBonds
 *
 * Usage:
 *   PRIVATE_KEY=0x... MONAD_RPC_URL=https://... \
 *     MODE=auction pnpm tsx scripts/lifecycle-run.ts
 *   MODE=lucky_draw pnpm tsx scripts/lifecycle-run.ts
 *
 * Prints a Markdown-ready table of every tx hash to stdout, and writes the
 * full JSON log to scripts/out/lifecycle-<mode>-<timestamp>.json.
 */

import { createPublicClient, createWalletClient, http, keccak256, encodePacked, parseUnits } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mkdirSync, writeFileSync } from 'fs';
import { circleAbi, circleFactoryAbi, mockStableAbi, addresses } from '@bhishi/shared';

const MONAD_TESTNET = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz'] } },
} as const;

const MODE = (process.env.MODE ?? 'auction').toLowerCase(); // 'auction' | 'lucky_draw'
const isAuction = MODE === 'auction';
const CONTRIB = parseUnits('10', 6); // 10 mUSDC
const SEATS = 3;
const BOND = BigInt(SEATS - 1) * CONTRIB; // 20 mUSDC

type Step = { step: string; who?: string; tx: string };
const log: Step[] = [];

function record(step: string, tx: string, who?: string) {
  log.push({ step, who, tx });
  console.log(`  [${step}]${who ? ` ${who}` : ''} ${tx}`);
}

async function main() {
  const deployerPk = process.env.PRIVATE_KEY as `0x${string}`;
  if (!deployerPk) throw new Error('PRIVATE_KEY required');

  const publicClient = createPublicClient({ chain: MONAD_TESTNET, transport: http() });
  const deployer = privateKeyToAccount(deployerPk);
  const deployerClient = createWalletClient({ account: deployer, chain: MONAD_TESTNET, transport: http() });

  console.log(`\nBhishi live lifecycle run — MODE=${MODE}`);
  console.log(`Factory: ${addresses.monadTestnet.factory}`);
  console.log(`Deployer: ${deployer.address}\n`);

  // Ephemeral member keys, deterministic per mode so re-runs are traceable.
  const memberKeys = [0, 1, 2].map(
    i => keccak256(encodePacked(['string', 'uint256', 'address'], [`bhishi-${MODE}-member`, BigInt(i), deployer.address])),
  ) as `0x${string}`[];
  const members: PrivateKeyAccount[] = memberKeys.map(privateKeyToAccount);
  const memberClients = members.map(m => createWalletClient({ account: m, chain: MONAD_TESTNET, transport: http() }));

  console.log('Members:', members.map(m => m.address).join(', '), '\n');

  const resumeCircle = process.env.RESUME_CIRCLE as `0x${string}` | undefined;
  const resumeFromRound = Number(process.env.RESUME_ROUND ?? '0');
  let circleAddr: `0x${string}`;

  if (resumeCircle) {
    circleAddr = resumeCircle;
    console.log(`Resuming existing circle ${circleAddr} from round ${resumeFromRound}\n`);
  } else {
    // ── Fund members: gas (MON) + mUSDC (bond + seats*contrib) ──────────────
    console.log('Funding members (mUSDC from deployer + MON for gas)...');
    const perMember = BOND + BigInt(SEATS) * CONTRIB;
    const deployerBal = (await publicClient.readContract({
      address: addresses.monadTestnet.mockStable, abi: mockStableAbi as any, functionName: 'balanceOf', args: [deployer.address],
    })) as bigint;
    if (deployerBal < perMember * 3n) {
      const faucetHash = await deployerClient.writeContract({
        address: addresses.monadTestnet.mockStable, abi: mockStableAbi as any, functionName: 'faucet', args: [],
      });
      await publicClient.waitForTransactionReceipt({ hash: faucetHash });
      record('faucet (deployer)', faucetHash);
    } else {
      console.log(`  deployer already has ${deployerBal} mUSDC, skipping faucet (cooldown-safe)`);
    }

    for (let i = 0; i < 3; i++) {
      const transferHash = await deployerClient.writeContract({
        address: addresses.monadTestnet.mockStable, abi: mockStableAbi as any, functionName: 'transfer',
        args: [members[i].address, perMember],
      });
      await publicClient.waitForTransactionReceipt({ hash: transferHash });
      record('fund mUSDC', transferHash, `member${i}`);

      const gasHash = await deployerClient.sendTransaction({ to: members[i].address, value: parseUnits('0.6', 18) });
      await publicClient.waitForTransactionReceipt({ hash: gasHash });
      record('fund MON (gas)', gasHash, `member${i}`);
    }

    // ── Create circle, funding VRF up front (circle sponsors Entropy fee) ───
    const vrfFunding = (await publicClient.readContract({
      address: addresses.monadTestnet.factory, abi: circleFactoryAbi as any, functionName: 'vrfFundingFor', args: [BigInt(SEATS)],
    })) as bigint;
    console.log(`\nVRF funding needed for ${SEATS} draws: ${vrfFunding} wei`);

    const createHash = await deployerClient.writeContract({
      address: addresses.monadTestnet.factory, abi: circleFactoryAbi as any, functionName: 'createCircle',
      args: [CONTRIB, BigInt(SEATS), BOND, isAuction ? 1 : 0],
      value: vrfFunding,
    });
    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
    record('createCircle', createHash);

    // The clone's own address is the emitter of its first log (e.g. Initialized-
    // style event on the newly created Circle instance itself).
    circleAddr = createReceipt.logs[0].address as `0x${string}`;
    console.log(`Circle created at: ${circleAddr}\n`);

    // ── Join x3 ───────────────────────────────────────────────────────────
    for (let i = 0; i < 3; i++) {
      const approveHash = await memberClients[i].writeContract({
        address: addresses.monadTestnet.mockStable, abi: mockStableAbi as any, functionName: 'approve',
        args: [circleAddr, (1n << 255n)],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      record('approve mUSDC', approveHash, `member${i}`);

      const joinHash = await memberClients[i].writeContract({
        address: circleAddr, abi: circleAbi as any, functionName: 'join', args: [],
      });
      await publicClient.waitForTransactionReceipt({ hash: joinHash });
      record('join', joinHash, `member${i}`);
    }
  }

  // ── Rounds ──────────────────────────────────────────────────────────────
  const bids = [1_000_000n, 2_000_000n, 3_000_000n]; // 1/2/3 mUSDC, always under 40% cap
  const hasWon = async (addr: `0x${string}`) =>
    (await publicClient.readContract({ address: circleAddr, abi: circleAbi as any, functionName: 'hasWon', args: [addr] })) as boolean;

  // Skip straight to requestDraw for the resume round if the circle is
  // already sitting in DRAW phase (e.g. resuming after a manual fix-up).
  const resumePhase = process.env.RESUME_PHASE; // 'draw' to skip commit/reveal

  for (let round = resumeCircle ? resumeFromRound : 0; round < SEATS; round++) {
    console.log(`\n── Round ${round} ──`);
    const salt = keccak256(encodePacked(['string', 'uint256'], ['salt', BigInt(round)]));
    const skipToDraw = round === resumeFromRound && resumePhase === 'draw';

    if (!skipToDraw) {
      // COMMIT (everyone, including past winners — Design A)
      for (let i = 0; i < 3; i++) {
        const bidAmt = isAuction ? bids[i] : CONTRIB; // LUCKY_DRAW: amount must equal contribution
        const commitment = keccak256(encodePacked(['uint256', 'bytes32', 'address'], [bidAmt, salt, members[i].address]));
        const commitHash = await memberClients[i].writeContract({
          address: circleAddr, abi: circleAbi as any, functionName: 'commit', args: [commitment],
        });
        await publicClient.waitForTransactionReceipt({ hash: commitHash });
        record('commit', commitHash, `member${i}`);
      }

      const advanceHash = await deployerClient.writeContract({
        address: circleAddr, abi: circleAbi as any, functionName: 'advanceToReveal', args: [],
      });
      await publicClient.waitForTransactionReceipt({ hash: advanceHash });
      record('advanceToReveal', advanceHash);

      // REVEAL. AUCTION past winners are auto-revealed at commit() (excluded
      // from bidding) and must be skipped here or reveal() reverts AlreadyRevealed.
      // LUCKY_DRAW has no bidding to exclude winners from — they keep revealing
      // every round like anyone else (only excluded from being drawn again).
      for (let i = 0; i < 3; i++) {
        if (isAuction && (await hasWon(members[i].address))) continue;
        const bidAmt = isAuction ? bids[i] : CONTRIB;
        const revealHash = await memberClients[i].writeContract({
          address: circleAddr, abi: circleAbi as any, functionName: 'reveal', args: [bidAmt, salt],
        });
        await publicClient.waitForTransactionReceipt({ hash: revealHash });
        record('reveal', revealHash, `member${i}`);
      }
    } else {
      console.log('  (resuming mid-round: skipping commit/reveal, already in DRAW phase)');
    }

    // DRAW — request, then wait for Pyth's keeper (NOT self-fulfilled).
    const requestHash = await deployerClient.writeContract({
      address: circleAddr, abi: circleAbi as any, functionName: 'requestDraw', args: [],
    });
    await publicClient.waitForTransactionReceipt({ hash: requestHash });
    record('requestDraw', requestHash);

    console.log('  waiting for Pyth Entropy keeper to fulfil the draw...');
    const stateBefore = (await publicClient.readContract({ address: circleAddr, abi: circleAbi as any, functionName: 'state', args: [] })) as number;
    let fulfilled = false;
    let fulfillTx: string | undefined;
    for (let attempt = 0; attempt < 60; attempt++) { // up to ~5 min
      await new Promise(r => setTimeout(r, 5000));
      const state = (await publicClient.readContract({ address: circleAddr, abi: circleAbi as any, functionName: 'state', args: [] })) as number;
      if (state !== stateBefore) {
        fulfilled = true;
        // Find the WinnerDrawn/RoundStarted tx by scanning recent blocks for a
        // log from this circle. Monad testnet caps eth_getLogs at 100 blocks,
        // so scan backward in 100-block chunks until a log turns up.
        const currentBlock = await publicClient.getBlockNumber();
        const CHUNK = 100n;
        let to = currentBlock;
        for (let i = 0; i < 5 && !fulfillTx; i++) {
          const from = to - CHUNK + 1n > 0n ? to - CHUNK + 1n : 0n;
          const logs = await publicClient.getLogs({ address: circleAddr, fromBlock: from, toBlock: to });
          if (logs.length > 0) fulfillTx = logs[logs.length - 1].transactionHash ?? undefined;
          to = from - 1n;
          if (to < 0n) break;
          await new Promise(r => setTimeout(r, 150));
        }
        break;
      }
    }
    if (!fulfilled) throw new Error(`Pyth keeper did not fulfil round ${round} draw within timeout`);
    record('Pyth fulfilment (WinnerDrawn)', fulfillTx ?? '(see explorer for circle address)');

    // ── Conservation check ────────────────────────────────────────────────
    let totalClaim = 0n, totalBond = 0n;
    for (let i = 0; i < 3; i++) {
      const info = (await publicClient.readContract({
        address: circleAddr, abi: circleAbi as any, functionName: 'memberInfo', args: [members[i].address],
      })) as [boolean, bigint, bigint, bigint];
      totalClaim += info[3];
      totalBond += info[1];
      await new Promise(r => setTimeout(r, 150));
    }
    const bal = (await publicClient.readContract({ address: addresses.monadTestnet.mockStable, abi: mockStableAbi as any, functionName: 'balanceOf', args: [circleAddr] })) as bigint;
    const dust = (await publicClient.readContract({ address: circleAddr, abi: circleAbi as any, functionName: 'dustAccrued', args: [] })) as bigint;
    const undrawn = (await publicClient.readContract({ address: circleAddr, abi: circleAbi as any, functionName: 'undrawnPools', args: [] })) as bigint;
    const rhs = totalClaim + dust + undrawn + totalBond;
    console.log(`  conservation: balance=${bal} claim+dust+undrawn+bonds=${rhs} -> ${bal === rhs ? 'OK' : 'VIOLATED'}`);
    if (bal !== rhs) throw new Error(`CONSERVATION VIOLATED after round ${round}`);
  }

  const finalState = (await publicClient.readContract({ address: circleAddr, abi: circleAbi as any, functionName: 'state', args: [] })) as number;
  console.log(`\nFinal state: ${finalState} (7 = COMPLETED)`);
  for (let i = 0; i < 3; i++) {
    console.log(`  member${i} (${members[i].address}) hasWon:`, await hasWon(members[i].address));
  }

  mkdirSync('scripts/out', { recursive: true });
  const outPath = `scripts/out/lifecycle-${MODE}-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify({ mode: MODE, circle: circleAddr, members: members.map(m => m.address), finalState, log }, null, 2));
  console.log(`\nFull log written to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
