# Circle invitations & dashboard-first flow — design

Date: 2026-07-18
Branch: bhishi-impl

## Goal

Make invitations first-class in the circle lifecycle:

1. **Dashboard first screen = listed circles** — keep the circle list as the primary
   surface; ensure a freshly-created circle appears there immediately and expose a
   copyable invite link per circle.
2. **Email invites at creation** — the CreateWizard gains an optional "invite by email"
   field. On successful on-chain creation, the backend generates a **per-email invite
   token**, stores it, and sends each invitee a **real email (Resend)** carrying their
   tokenized link.
3. **Post-creation** — auto-navigate to the new circle page (today's behavior). The circle
   page surfaces the **general circle-level shareable link** the creator copies for anyone.
4. **Token-gated invite links** — opening a link validates the token:
   - already-authenticated user → straight to the normal join flow;
   - new user → Privy sign-in gate first (auth = "registered"), then redirected to the
     join step; the token is marked consumed and attributed to their address.

On-chain remains the source of truth. Circles are joinable by anyone on-chain; the token
gates the **UI/attribution**, not the contract. It intentionally does not block a
determined user from joining directly — it shapes the invited-user experience and records
who was invited/who consumed.

## Existing state (do not rebuild)

- `apps/web/src/app/dashboard/page.tsx` already lists circles as the first screen, via
  `GET /api/circles?mine=<addr>` (indexed, polled every 10s) with an empty state, and
  already `router.push`es to `/circle/<addr>` on create success.
- `CreateWizard` (`apps/web/src/components/CreateWizard.tsx`) owns the create tx and calls
  `onSuccess(addr)`.
- Backend: NestJS with modules for `circles`, `profiles`, `sponsor`, `waitlist`, `auth`
  (Privy guard), `prisma`. Prisma schema in `packages/db/prisma/schema.prisma` already has
  `UserProfile` and `NotificationLog`.

The genuinely new work is: an `Invite` model, an `InvitesModule`, an `EmailModule`
(Resend), and four frontend touch-points.

## Data model

New Prisma model `Invite` (in `packages/db/prisma/schema.prisma`):

```prisma
enum InviteKind {
  EMAIL   // per-email token generated at creation
  LINK    // general circle-level shareable link
}

enum InviteStatus {
  PENDING
  CONSUMED
  REVOKED
}

model Invite {
  id            String       @id @default(cuid())
  /// Random URL-safe token (crypto.randomBytes(24).base64url). Unique.
  token         String       @unique
  circle        Circle       @relation(fields: [circleAddress], references: [address], onDelete: Cascade)
  circleAddress String
  kind          InviteKind
  /// Present for EMAIL invites; null for the general LINK.
  email         String?
  /// Who created the invite (creator's lowercased wallet address).
  invitedBy     String
  status        InviteStatus @default(PENDING)
  /// Address that consumed it (lowercased), set when a user joins via the link.
  consumedBy    String?
  consumedAt    DateTime?
  createdAt     DateTime     @default(now())

  @@index([circleAddress])
  @@index([email])
}
```

Notes:
- A LINK invite is generated once per circle (idempotent: reuse existing LINK for the
  circle if present).
- EMAIL invites are one row per (circle, email). Re-inviting the same email reuses/re-sends
  the existing token rather than duplicating.
- **LINK validity is capacity-bounded by seats, not a single-use flag.** The LINK stays
  valid and reusable while `memberCount < circle.seats`; once the circle's seats are all
  filled it is no longer valid (a 2-seat circle's link dies after 2 members join). This is
  computed from the indexed `Member` count vs `Circle.seats` at validation time — no
  separate counter to drift, and it stays correct even if someone joins directly on-chain.
  A circle whose state has left `FILLING` (COMMIT/DRAW/etc.) is likewise full → invalid.
- EMAIL tokens flip to CONSUMED on the invitee's first join (one-shot attribution); they
  are also implicitly invalid once the circle is full, same as the LINK.

## Backend

### EmailModule (`apps/api/src/email/`)
- `EmailService` wrapping Resend (`resend` npm pkg). Reads `RESEND_API_KEY`,
  `EMAIL_FROM`, `PUBLIC_WEB_URL` from env (added to `config/env.validation.ts`, all
  optional with sensible fallbacks so local dev works).
- If `RESEND_API_KEY` is absent → **console-log fallback** (logs the email that *would*
  have been sent) so the whole flow works locally without a key. Every send writes a
  `NotificationLog` row (`channel: 'email'`, `kind: 'circle_invite'`, status
  queued→sent/failed).
- `sendCircleInvite({ to, circleAddress, inviteUrl, inviter })` renders a small HTML +
  text template.

### InvitesModule (`apps/api/src/invites/`)
Controller endpoints:
- `POST /api/invites` — **auth-guarded** (PrivyAuthGuard). Body:
  `{ circleAddress, emails?: string[] }`. Verifies the caller is the circle's `creator`
  (from the indexed `Circle` row) — only the creator may invite. Generates:
  - the general LINK token (idempotent), and
  - one EMAIL token per address, then triggers `EmailService.sendCircleInvite` for each.
  Returns `{ linkUrl, invited: [{ email, url }] }`.
- `GET /api/invites/:token` — **public**. Validates the token → returns
  `{ valid, circleAddress, kind, status, reason? }`. A token is `valid: false` when it is
  unknown/revoked, **or the circle is full** — computed as
  `indexed Member count >= Circle.seats` (or the circle has left `FILLING`). `reason` is
  `'unknown' | 'revoked' | 'full'` so the UI can message precisely ("This circle is now
  full"). Used by the frontend gate to resolve where to route.
- `POST /api/invites/:token/consume` — **auth-guarded**. Marks the invite CONSUMED and
  sets `consumedBy = caller address` (best-effort attribution; never blocks joining).

`InviteUrl` shape: `${PUBLIC_WEB_URL}/circle/${circleAddress}?invite=${token}`.

### Env additions (`config/env.validation.ts`)
`RESEND_API_KEY?`, `EMAIL_FROM?` (default `Bhishi <onboarding@resend.dev>`),
`PUBLIC_WEB_URL?` (default `http://localhost:3000`).

## Frontend

### CreateWizard (`components/CreateWizard.tsx`)
- Add an optional **"Invite by email"** textarea/chips field (parse comma/newline/space
  separated, validate loosely). Purely additive; leaving it empty preserves today's flow.
- After the create tx confirms and we have `newAddr`, call `POST /api/invites` with the
  emails (and always to mint the LINK token). Failure here is **non-fatal** — the circle
  exists on-chain regardless; show a soft warning but still call `onSuccess`.
- `onSuccess(addr)` signature unchanged.

### Dashboard (`app/dashboard/page.tsx`)
- **Auto-navigate to `/circle/<addr>` on create success — unchanged from today.** The
  invite link + email-invite field live on the circle page, so the creator lands there and
  copies/sends from there.
- Circle list already refreshes; no change needed beyond confirming the new circle shows
  (it does, via `mine=`).

### CircleCard / circle detail (`components/CircleView.tsx`, `components/CircleCard.tsx`)
- Add a small **"Invite / copy link"** affordance on the circle detail (and optionally the
  card) so the creator can re-open the share panel + email-invite field any time, not only
  at creation. Fetches/mints the LINK token via `POST /api/invites`.

### Invite-gated landing (`app/circle/[id]/page.tsx` + `CircleView.tsx`)
- Read `?invite=<token>` from the URL. On mount, `GET /api/invites/:token` to validate.
- If **authenticated** → proceed to the normal join UI (existing `CircleView`), then fire
  `POST /api/invites/:token/consume` once joined (attribution).
- If **not authenticated** → the existing `AuthGate` already blocks with a Privy sign-in
  prompt ("Sign in to join this circle"). After the user authenticates (wallet created =
  registered), they're already on the same URL, so they flow straight into the join step.
  We persist the `?invite` token through the auth redirect (it stays in the URL), then
  consume on join.
- Invalid token → show a `reason`-specific notice: `full` → "This circle is now full",
  `revoked`/`unknown` → "This invite link is no longer valid". The public circle stays
  viewable (on-chain-open); the join button is hidden/disabled when the circle is full,
  which the existing `CircleView` state logic already handles.

## Flow summary

**Creator:** create circle → (optional) enter emails → tx confirms → **auto-navigates to
the circle page**, where the backend has minted the LINK + per-email tokens and sent the
emails; the creator copies the link from there. Circle also appears on the dashboard.

**Invited existing user:** opens link → token validated → already signed in → join UI →
join → token consumed.

**Invited new user:** opens link → token validated → AuthGate sign-in (Privy creates
wallet = registered) → same URL now authenticated → join UI → join → token consumed.

## Non-goals / YAGNI

- No hard single-use enforcement that blocks joining (contract is open anyway).
- No profile-completion step before join (Privy auth alone = registered, per decision).
- No email scheduling/queue worker beyond the existing NotificationLog audit; sends are
  inline (best-effort) at invite time.
- No revocation UI in this pass (REVOKED status exists in the model for later).

## Testing

- Backend: unit tests for `InvitesService` (creator-only guard, idempotent LINK, per-email
  token reuse, consume attribution) and `EmailService` console fallback. Follow existing
  `*.spec.ts` style (e.g. `waitlist.service.spec.ts`).
- Frontend: manual E2E of the three flows on Monad testnet (create+invite, existing-user
  link join, new-user link join) — matches how the repo verifies flows today.
