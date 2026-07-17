'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useMember } from '@/lib/member';
import { claimFaucet } from '@/lib/faucet';
import { stableBalance } from '@/lib/erc20';
import { Button, Card, Eyebrow } from '@/components/ui';

/**
 * Test-funds faucet. `variant="card"` is the full panel for the /faucet page;
 * `variant="inline"` is a compact balance + claim used in the dashboard strip.
 */
export function Faucet({ variant = 'card' }: { variant?: 'card' | 'inline' }) {
  const { authenticated, login, ready: privyReady } = usePrivy();
  const { address, write } = useMember();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Authenticated but the embedded/smart wallet is still resolving (useWallets
  // populates a tick after login). Until an address lands, claim() has nothing to
  // send from — so the button must be disabled, not a silent no-op that looks
  // broken. Mirrors the CreateWizard fix.
  const walletResolving = authenticated && !address;
  const disabled = pending || !privyReady || walletResolving;

  const refresh = useCallback(async () => {
    if (!address) return;
    setBalance(await stableBalance(address).catch(() => 0n));
  }, [address]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function claim() {
    // Not signed in → start login and stop; the click after auth claims.
    if (!authenticated) { await login(); return; }
    // Signed in but no wallet yet: tell the user instead of silently doing
    // nothing (the old `if (!address) return` was why the button felt dead).
    if (!address) {
      setMsg({ kind: 'err', text: 'Setting up your wallet — one moment, then tap claim again.' });
      return;
    }
    setPending(true);
    setMsg(null);
    try {
      await claimFaucet(write, address);
      await refresh();
      setMsg({ kind: 'ok', text: '500 mUSDC added to your wallet.' });
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : 'Faucet failed';
      setMsg({ kind: 'err', text: m });
    } finally {
      setPending(false);
    }
  }

  const balanceStr = balance === null ? '—' : (Number(balance) / 1e6).toFixed(2);

  if (variant === 'inline') {
    return (
      <div>
        <div className="text-xs text-[#6b6470]">Wallet balance</div>
        <div className="font-display font-semibold text-[28px] mt-1.5">
          {balanceStr} <span className="text-sm text-[#6b6470] font-sans font-medium">mUSDC</span>
        </div>
        <button
          onClick={claim}
          disabled={disabled}
          className="mt-1 text-xs text-[#c9a15c] border-b border-[#c9a15c] pb-px hover:opacity-70 disabled:opacity-40"
        >
          {pending ? 'Claiming…' : walletResolving ? 'Preparing wallet…' : 'Get test funds →'}
        </button>
        {msg && (
          <p className={`mt-2 text-xs ${msg.kind === 'ok' ? 'text-[#3a6d4a]' : 'text-[#9a4a3a]'}`}>{msg.text}</p>
        )}
      </div>
    );
  }

  return (
    <Card className="p-7">
      <Eyebrow>Testnet faucet</Eyebrow>
      <h2 className="font-display font-semibold text-2xl mt-3">Get test mUSDC</h2>
      <p className="text-[#6b6470] text-sm mt-2 leading-relaxed">
        Bhishi runs on Monad testnet with a mock stablecoin. Claim 500 mUSDC to join or start a
        circle. You can claim again once every 24 hours.
      </p>

      <div className="mt-6 flex items-end justify-between gap-4">
        <div>
          <div className="text-xs text-[#6b6470]">Your balance</div>
          <div className="font-display font-semibold text-3xl mt-1">
            {balanceStr} <span className="text-base text-[#6b6470] font-sans font-medium">mUSDC</span>
          </div>
        </div>
        <Button variant="brass" onClick={claim} disabled={disabled}>
          {pending ? 'Claiming…' : walletResolving ? 'Preparing wallet…' : 'Claim 500 mUSDC'}
        </Button>
      </div>

      {msg && (
        <p className={`mt-4 text-sm rounded-sm px-3 py-2 ${
          msg.kind === 'ok' ? 'bg-[#e6efe8] text-[#3a6d4a]' : 'bg-[#f3e3e0] text-[#9a4a3a]'
        }`}>
          {msg.text}
        </p>
      )}
    </Card>
  );
}
