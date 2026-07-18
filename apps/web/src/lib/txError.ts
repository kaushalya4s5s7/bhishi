/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Turn a viem / ERC-4337-bundler error into a message worth showing a user.
 *
 * The raw `shortMessage` for a bundler-rejected UserOp is often a cryptic
 * abbreviation ("bw", "AA23", …) that means nothing on its own — it's the
 * paymaster/bundler's own reason code, not our contract's. So we:
 *  1. ALWAYS log the full error object to the console (for diagnosis), and
 *  2. walk the error's cause chain for a human-readable custom-error name
 *     (e.g. "NotFilling", "FaucetCooldown") before falling back to shortMessage.
 *
 * Known short codes are mapped to a friendlier hint where we can.
 */

// Bundler / EntryPoint / paymaster short codes → human hints.
const SHORT_CODE_HINTS: Record<string, string> = {
  // ERC-4337 EntryPoint validation failures.
  aa21: 'Wallet has no funds and the paymaster didn’t cover it — sponsorship may be unavailable right now.',
  aa23: 'Wallet validation reverted — the transaction would fail on-chain (often a require/allowance/phase check).',
  aa31: 'Paymaster ran out of deposit to sponsor gas.',
  aa33: 'Paymaster rejected sponsoring this transaction.',
  aa40: 'Bundler timed out verifying the transaction.',
};

// Our contracts' custom-error selectors → friendly text. A smart-account
// UserOp surfaces the raw 4-byte selector (e.g. 0x62771006) instead of the
// decoded name that a plain eth_call would give, so we map them by hand.
const CUSTOM_ERROR_SELECTORS: Record<string, string> = {
  '0xf381ae23': 'This circle isn’t open for joining right now.', // NotFilling
  '0x003b2682': 'You’ve already joined this circle.', // AlreadyJoined
  '0xdc816a87': 'It’s not the commit phase right now.', // NotCommitPhase
  '0xbfec5558': 'You’ve already committed this round.', // AlreadyCommitted
  '0x81791cb4': 'You haven’t committed this round.', // NotCommitted
  '0xd1088db6': 'It’s not the reveal phase right now.', // NotRevealPhase
  '0xa89ac151': 'You’ve already revealed this round.', // AlreadyRevealed
  '0x9ea6d127': 'Reveal failed — the secret doesn’t match your commit.', // InvalidReveal
  '0x291fc442': 'You’re not a member of this circle.', // NotMember
  '0x969bf728': 'Nothing to claim right now.', // NothingToClaim
  '0x62771006': 'Faucet already claimed — try again after the 24h cooldown.', // FaucetCooldown
  '0x09f67491': 'The circle doesn’t have enough MON to fund the draw yet.', // InsufficientVrfFunding
  '0xe1a70396': 'Not everyone has committed yet — the reveal phase can’t start.', // CommitPhaseNotComplete
  '0x6e360f94': 'Bond is too low for this circle’s parameters.', // BondTooLow
};

/** Deepest `.cause` in the chain (viem nests the real revert several levels down). */
function rootCause(err: any): any {
  let cur = err;
  const seen = new Set<any>();
  while (cur?.cause && !seen.has(cur.cause)) {
    seen.add(cur.cause);
    cur = cur.cause;
  }
  return cur;
}

/** Extract a decoded custom-error name if viem attached one. */
function customErrorName(err: any): string | undefined {
  // viem's ContractFunctionRevertedError puts the decoded error on `.data`.
  const fromData = err?.data?.errorName ?? rootCause(err)?.data?.errorName;
  if (typeof fromData === 'string') return fromData;
  return undefined;
}

export function formatTxError(err: any, fallback = 'Transaction failed'): string {
  // eslint-disable-next-line no-console
  console.error('[tx error]', err);

  const name = customErrorName(err);
  if (name) return `Reverted: ${name}`;

  // Gather all the text viem may have tucked the reason into.
  const short: string = err?.shortMessage ?? err?.details ?? err?.message ?? '';
  const haystack = `${err?.shortMessage ?? ''} ${err?.details ?? ''} ${err?.message ?? ''}`;

  // A raw custom-error selector (0x62771006, …) — the form a smart-account
  // UserOp simulation surfaces. Matched anywhere in the error text.
  const selectorMatch = haystack.match(/0x[0-9a-fA-F]{8}\b/g);
  if (selectorMatch) {
    for (const sel of selectorMatch) {
      const hit = CUSTOM_ERROR_SELECTORS[sel.toLowerCase()];
      if (hit) return hit;
    }
  }

  const code = short.trim().toLowerCase();
  if (SHORT_CODE_HINTS[code]) return SHORT_CODE_HINTS[code];

  // If shortMessage embeds a known bundler code (e.g. "AA33 reverted"), map it.
  for (const key of Object.keys(SHORT_CODE_HINTS)) {
    const re = new RegExp(`\\b${key}\\b`, 'i');
    if (re.test(haystack)) return SHORT_CODE_HINTS[key];
  }

  return short || fallback;
}
