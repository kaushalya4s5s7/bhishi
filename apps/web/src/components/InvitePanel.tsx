'use client';
import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { createInvites, parseEmails } from '@/lib/invites';
import { Button, Card, Eyebrow } from '@/components/ui';

interface InvitePanelProps {
  circleAddress: `0x${string}`;
}

/**
 * Creator-facing invite controls on the circle page: copy the reusable link and
 * send email invites. The reusable link stays valid until the circle's seats
 * fill (enforced server-side). Non-creators get a 403 from the API — we surface
 * that softly rather than assuming a role client-side.
 */
export function InvitePanel({ circleAddress }: InvitePanelProps) {
  const { getAccessToken } = usePrivy();
  const [emails, setEmails] = useState('');
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = (token: string) =>
    `${window.location.origin}/circle/${circleAddress}?invite=${token}`;

  async function mint() {
    setBusy(true);
    setMsg(null);
    try {
      const token = await getAccessToken();
      // The API resolves the creator straight from chain, so the link is
      // available the instant createCircle mines — no indexer wait. A 409 only
      // happens if the circle isn't visible on chain yet (RPC lag) or the read
      // failed; retry briefly on that before surfacing anything. A 403 (genuine
      // non-creator) is never retried.
      let res: Awaited<ReturnType<typeof createInvites>> | undefined;
      for (let i = 0; i < 4; i++) {
        try {
          res = await createInvites(token, circleAddress, parseEmails(emails));
          break;
        } catch (err: unknown) {
          const m = err instanceof Error ? err.message : '';
          const retryable = /not found yet|not indexed/i.test(m) || m.includes('409');
          if (!retryable || i === 3) throw err;
          await new Promise(r => setTimeout(r, 1200));
        }
      }
      if (!res) throw new Error('Could not create invites.');
      const tok = new URL(res.linkUrl).searchParams.get('invite') ?? '';
      setLinkUrl(shareUrl(tok));
      const sent = res.invited.length;
      const failed = res.failed?.length ?? 0;
      const parts: string[] = [];
      if (sent > 0) parts.push(`Sent ${sent} email invite${sent === 1 ? '' : 's'}.`);
      if (failed > 0) parts.push(`Failed to email ${res.failed.join(', ')} — the link still works, share it directly.`);
      if (parts.length > 0) setMsg(parts.join(' '));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : undefined;
      // Only the genuine creator-mismatch (403) shows the creator message. A
      // 409 ("not found yet" — chain not caught up / RPC hiccup) gets its own
      // copy so it's never mislabeled as an authorization problem.
      if (/not found yet|not indexed/i.test(message ?? '') || message?.includes('409')) {
        setMsg('Circle not visible on-chain yet — wait a moment and try again.');
      } else if (message?.includes('403') || /creator/i.test(message ?? '')) {
        setMsg('Only the circle creator can send invites.');
      } else {
        setMsg(message ?? 'Could not create invites.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!linkUrl) return;
    await navigator.clipboard.writeText(linkUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const field =
    'w-full px-3 py-2.5 border border-[#e6e2d9] rounded-sm bg-white text-sm focus:outline-none focus:border-[#c9a15c]';

  return (
    <Card className="p-5">
      <Eyebrow muted>Invite</Eyebrow>
      <p className="text-sm text-[#6b6470] mt-2 mb-4">
        Share a link with your group, or send email invites. The link works until every seat is filled.
      </p>
      <textarea
        value={emails}
        onChange={e => setEmails(e.target.value)}
        placeholder="alice@example.com, bob@example.com (optional)"
        rows={2}
        className={`${field} resize-none mb-3`}
      />
      <div className="flex gap-2 flex-wrap">
        <Button onClick={mint} disabled={busy}>
          {busy ? 'Working…' : linkUrl ? 'Refresh link / send' : 'Create invite link'}
        </Button>
        {linkUrl && (
          <Button variant="ghost" onClick={copy}>
            {copied ? 'Copied!' : 'Copy link'}
          </Button>
        )}
      </div>
      {linkUrl && (
        <p className="text-xs text-[#6b6470] mt-3 break-all font-mono bg-[#f0ead8]/50 border border-[#e6e2d9] rounded-sm px-3 py-2">
          {linkUrl}
        </p>
      )}
      {msg && <p className="text-xs text-[#6b6470] mt-2">{msg}</p>}
    </Card>
  );
}
