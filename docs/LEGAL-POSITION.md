# Bhishi — Legal Position (India / Maharashtra)

> This document exists so a reviewer, investor, or future co-founder never has to *ask* whether we thought
> about regulatory exposure — the open questions and our current stance are written down honestly. This is
> **not legal advice** and has **not** been reviewed by counsel. It is a founder's risk map, written with the
> same honesty rule as `THREAT-MODEL.md`: if we're not sure, we say so; if something is out of scope, we say
> that too.

The unifying stance:

> **Bhishi is software. It is not a registered chit fund company, not a money-transmission service, and not
> a fiat on/off-ramp.** Where the law is genuinely unsettled for what we've built, we say "open question," not
> "exempt."

---

## 1. Why this document is separate from the architecture spec

`architecture-spec.md` and `THREAT-MODEL.md` cover **technical/economic** risk — code that can be tested,
proven, fuzzed. Legal risk can't be fuzz-tested; it's resolved by regulators and courts, on their timeline,
not ours. Keeping this in its own doc means:
- Technical claims stay falsifiable (`forge test` proves them).
- Legal claims stay honest ("untested" is a real, correct answer here, not a hedge).
- Anyone diligencing the project (investor, partner, regulator, future hire) can read this section without
  wading through Solidity.

---

## 2. The core tension: "chit fund" is a loaded word in India

Bhishi is functionally a ROSCA — the same social pattern as a traditional Indian *chit* / *committee*
(bhishi). That similarity is the whole pitch to users. It is also exactly why we do not describe ourselves,
in India-facing copy, as *"a chit fund."* We are describing a mechanism, not claiming a regulatory category.

**Why the word matters:** the **Chit Funds Act, 1982** (Central Act No. 40 of 1982) creates a licensing
regime for a **human "foreman"** who collects subscriptions, holds the pool, and disburses the prize. It
requires State Government sanction before starting a chit (S.4), registration with the state Registrar of
Chit Funds, a security deposit of ~1–1.5x the chit value lodged with the Registrar, and (for companies
running chit business) minimum paid-up capital. In Maharashtra specifically, the **Maharashtra Chit Fund
Rules, 2004** designate a state Registrar under the Cooperation/GST department; a 2023 amendment bill mainly
reworked the appeal mechanism and did not substantively expand the regime.

**Where Bhishi differs on paper:** the Act's definitions presume a foreman who *holds* the money. In Bhishi,
no human or company ever custodies the pool — a smart contract does, verifiably (see `architecture-spec.md`
§4, §10: `Custody.t.sol` asserts every organizer-withdraw path reverts). That is a real, structural
difference from the fact pattern the 1982 Act was written for.

**What we are NOT claiming:** that this difference means the Act doesn't apply. **No Indian court or
regulator has ruled on whether a non-custodial, smart-contract-run ROSCA falls inside or outside "chit
business" as defined in the Act.** This is genuinely untested. Global regulatory practice (FATF-aligned VASP
guidance) tends to look past a "non-custodial" label to actual control levers — who holds admin keys, who can
upgrade the contract, who controls the interface users interact with — when deciding whether someone is
acting "for or on behalf of" users. Our engineering answer (no admin key, no upgrade path, no organizer
discretion — see `THREAT-MODEL.md` T1–T2) is designed to make that control-lever analysis come out clean. It
has not been tested against it in a courtroom or by a regulator.

**Our stance, stated plainly:** *open question, not exemption.* We do not register as a chit fund company
today because we do not custody funds and are not conducting chit business as traditionally practiced; if
regulatory guidance or a ruling says otherwise, that becomes the highest-priority item on the roadmap (§6).

---

## 3. The layer that is *not* an open question: crypto / VDA rules

Unlike the chit-fund question, the Virtual Digital Asset (VDA) tax and reporting regime applies to Bhishi
regardless of how the product is characterized, because contributions/payouts move in a stablecoin.

- **Income Tax Act — S.115BBH:** flat 30% tax + 4% cess on VDA transfer gains, no loss set-off against other
  income, only cost of acquisition deductible. Applies to any user's gains from holding/transacting the
  stablecoin, independent of Bhishi's role.
- **Income Tax Act — S.194S:** 1% TDS on VDA transfer consideration above annual thresholds (₹50k standard /
  ₹10k specified persons), deducted by the payer side of a transfer.
- **RBI posture:** RBI has told Parliament's Standing Committee it does not favor legalizing VDAs and
  prefers CBDC (e-Rupee) rails. This is a hostile-to-neutral posture, not a ban on the underlying technology,
  but it means no assumption of regulatory goodwill.
- **FEMA:** stablecoins are not "currency" under FEMA S.2(h); cross-border stablecoin flows sit in a genuine
  grey zone. Enforcement is active, not theoretical — ED raided crypto-payment firms in mid-2026 over
  unauthorized cross-border stablecoin transfers under FEMA.
- **PMLA / FIU-IND:** a 2023 Finance Ministry notification brought VDA activity under PMLA. Entities acting
  as Virtual Asset Service Providers (exchanges, custodial wallets, on/off-ramps) must register with FIU-IND
  as reporting entities — KYC, 5-year record retention, suspicious-transaction reporting.

**What this means for Bhishi today:** on Monad testnet with `MockStable` (a faucet-mintable mock ERC-20,
`architecture-spec.md` §4), none of the above is triggered — there is no real-value transfer, no VDA gain, no
fiat leg. **The moment any of the following ships, this section stops being hypothetical:**
1. A real stablecoin (real value) replaces `MockStable`.
2. A fiat ↔ stablecoin on/off-ramp goes live (currently waitlist-only per `architecture-spec.md` §11.5, §15
   — explicitly *not* built, framed honestly as "coming soon").

---

## 4. Why the waitlist-only off-ramp is a legal decision, not just a scope decision

`architecture-spec.md` §11.5 already states the off-ramp is a waitlist, not a live feature, and that the UI
must not imply otherwise. That product decision is also the load-bearing legal boundary described in §3
above: as long as Bhishi never itself moves fiat, it is not the party that needs FIU-IND registration or a
money-transmission license. The moment a fiat leg is built, it must sit behind a **licensed, FIU-IND
registered partner** — not be self-operated. This is stated as a hard requirement in the roadmap (§6), not a
"nice to have."

---

## 5. Traditional chit-fund fraud law, for context (not currently applicable, watch list)

Classic chit-fund fraud (Ponzi-style collection schemes, e.g. Rose Valley/Saradha-type cases) is prosecuted
under the **Prize Chit and Money Circulation Schemes (Banning) Act, 1978** and, post-2024, under Bharatiya
Nyaya Sanhita provisions (Ss.316/318) covering criminal breach of trust and cheating. These target schemes
where an operator collects money under a promise and does not deliver — the exact failure mode Bhishi's
non-custodial design and permissionless reclaim paths (`THREAT-MODEL.md` T3, T7) are built to make
structurally impossible. No case matching Bhishi's exact fact pattern (non-custodial, smart-contract ROSCA)
has been reported in India as of this writing. Flagged here as a watch-list item, not a current exposure —
our engineering answer to "can the operator run off with the money" is "there is no code path for that,"
which is the substance regulators here actually care about, even if the citation doesn't exist yet.

---

## 6. Roadmap — legal (say these openly, same as the technical roadmap)

- **Do not** self-operate a fiat on/off-ramp. Partner with a licensed, FIU-IND-registered VASP or bank rail
  when the off-ramp ships (ties to `architecture-spec.md` §15).
- Monitor for Indian regulatory guidance or rulings specifically addressing non-custodial/smart-contract
  ROSCAs; treat any such guidance as immediately authoritative over §2's "open question" framing.
- If/when real-value stablecoins replace `MockStable`, revisit S.115BBH/194S obligations for users and
  determine whether Bhishi (as a platform, not custodian) has any reporting duty.
- Get an actual legal opinion before any India-facing public launch beyond hackathon/testnet demo scope.
  Everything in this document is founder-level risk-mapping, not a substitute for one.
- Keep India-facing marketing copy as "onchain savings circle" / "ROSCA," not "chit fund" — avoid inviting a
  direct regulatory-category comparison the product has not resolved.

---

## 7. Sources consulted

- Chit Funds Act, 1982 (Act No. 40 of 1982) — RBI Sachet portal copy; indiacode.nic.in
- Maharashtra Chit Fund Rules, 2004; Chit Funds (Maharashtra Amendment) Bill, 2023 (PRS Legislative Research)
- Income Tax Act — S.115BBH, S.194S (VDA taxation)
- 2023 Finance Ministry PMLA notification bringing VDA activity into scope; FIU-IND VASP registration
  reporting (public reporting on registration counts, FY24-25)
- Public reporting on RBI's stated posture toward VDAs (Parliamentary Standing Committee, 2026) and on 2026
  FEMA enforcement action against crypto-payment firms over cross-border stablecoin transfers
- Prize Chit and Money Circulation Schemes (Banning) Act, 1978; Bharatiya Nyaya Sanhita 2024 Ss.316/318

If a claim in this document turns out to be wrong or superseded, that is a bug in the document — same rule
as `THREAT-MODEL.md`.
