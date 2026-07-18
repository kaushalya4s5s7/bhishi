import { apiUrl } from './api';

/** A member row as the indexer records it (Postgres-backed /detail endpoint). */
export interface CircleMemberRow {
  address: string;
  joinedAt: string;
  hasWon: boolean;
  slashed: boolean;
}

/** A round row from the indexer. `winner` is the drawn winner once DRAW resolves. */
export interface CircleRoundRow {
  roundNumber: number;
  phase: string;
  winner: string | null;
  drawRequestedAt: string | null;
}

/**
 * Full circle detail, served from Postgres by the indexer (~40ms) instead of
 * 3+ sequential Monad-RPC round-trips (~1.5s each). This is the same indexed
 * data the dashboard already reads — every display field the circle page needs
 * (state, seats, contribution, bond, round, member list, winners) is here.
 *
 * On-chain stays the source of truth: the page still refreshes the handful of
 * fields an action depends on (a member's own commit/reveal/claim state) live
 * from the contract in the background, so a button never fires on stale state.
 * But the INITIAL render comes from here, so there's no multi-second RPC wait.
 */
export interface CircleDetail {
  address: string;
  creator: string;
  seats: number;
  contribution: string;
  bond: string;
  mode: 'LUCKY_DRAW' | 'AUCTION';
  state: string;
  currentRound: number;
  members: CircleMemberRow[];
  rounds: CircleRoundRow[];
}

/** Fetch a circle's indexed detail. Throws on network/HTTP error. */
export async function fetchCircleDetail(circleAddress: string): Promise<CircleDetail> {
  const res = await fetch(apiUrl(`/api/circles/${circleAddress}`));
  if (!res.ok) throw new Error(`Circle detail failed (${res.status})`);
  return res.json();
}
