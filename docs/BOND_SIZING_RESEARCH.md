# Bond Sizing Research (DESIGN_A_PLAN.md Part 8)

## Question

With Design A (every member, including past winners, pays `contribution` every
round), does `BOND = (seats - 1) * contribution` still cover the worst-case
default?

## Worst case

A member wins round 0 (collects the pot), then defaults on every subsequent
round without paying again. For a `seats`-member circle, that member owes
`contribution` for each of the remaining `seats - 1` rounds.

`slash()` (`Circle.sol`) tops up the missing contribution for the round they
defaulted on from their bond, then distributes any remainder pro-rata to
compliant members. The bond is consumed by the FIRST default's `slash()` call
— the member is removed from `joined` at that point (`def.joined = false`),
so they cannot default again in a later round (they're no longer a member).

So the actual worst case is **one missed round's contribution**, not
`seats - 1` rounds' worth — a defaulting member is slashed and evicted on
their first miss, not left in the circle to keep defaulting.

`BOND = (seats - 1) * contribution` therefore over-collateralizes a single
default by a factor of `(seats - 1)`. This was already true before Design A
(the bond-vs-default-window relationship didn't change) — Design A does not
reduce the bond's adequacy, since:

- A winner's post-win obligation per round is unchanged: `contribution`.
- `slash()` evicts on the first missed round regardless of how many rounds
  remain, so the bond only ever needs to cover one round's shortfall.
- What Design A DOES change is that a winner who defaults now enters `slash()`
  eligibility every round going forward (`hasWon[m]` no longer exempts them
  from paying) — previously a winner was auto-committed/revealed and could
  never be slashed for non-payment. This is the fix's intended effect
  ([`Circle.sol`](../packages/contracts/src/Circle.sol) `slash()` docstring:
  "past winner who fails to pay... is now slashable exactly like anyone
  else").

## Conclusion

`BOND = (seats - 1) * contribution` remains more than sufficient — it's
`(seats - 1)×` the actual worst-case single-round shortfall. This is a safety
margin already baked in, not a gap Design A introduces or should tighten. No
contract change recommended.

Two things worth deciding, not changing code for yet:
1. Whether the `(seats - 1)×` margin is more collateral than necessary for a
   testnet/demo product (it makes joining expensive — a 5-seat, 100 mUSDC
   circle requires a 400 mUSDC bond). A smaller bond (e.g. `2 * contribution`,
   covering one slash cycle plus buffer) would lower the join barrier but
   trades away margin for RPC/timing edge cases (e.g. a slash that fires late
   due to a stalled indexer or RPC lag).
2. Real-world ROSCA/chit-fund practice (Indian Chit Funds Act 1982 + 2019
   amendment) requires the foreman to post security equal to the fund value,
   not each subscriber individually — this contract's per-member bond model
   is a deliberate simplification (no foreman/organizer role holds aggregate
   risk) and doesn't map 1:1 onto the Act's framework. Documenting this
   divergence is a legal/compliance question for mainnet, not a contract bug.

**Status: research complete, no code change required.** Revisit before
mainnet if bond size becomes a UX complaint (Note 1 above).
