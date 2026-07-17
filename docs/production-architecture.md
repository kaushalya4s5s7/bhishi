# Bhishi — Production Architecture (Off-Chain Layer)

> Companion to [`architecture-spec.md`](./architecture-spec.md), which owns the on-chain design
> (contracts, state machine, VRF fairness/liveness model, collateral economics). This document
> owns everything **off-chain**: backend, database, cache/queue, workers, and deployment —
> the layer that does not exist yet in the current hackathon build.

**Status quo (2026-07-16):** the only server code in the repo is one Next.js route handler
(`apps/web/src/app/api/waitlist/route.ts`) that `console.log`s a form submission. There is no
database, no queue, no worker, no CI, no Docker. Chain reads happen client-side via viem directly
from the browser. This doc describes what replaces that stub for production.

---

## 1. Why a backend is needed at all

The contracts are deliberately self-sufficient — no organizer or backend has custody or discretion
(see architecture-spec §2, §10). The backend does **not** sit in the trust boundary for fund safety.
It exists for three reasons that pure client-side viem reads can't solve well at scale:

1. **Fast, indexed reads.** `getLogs` from the browser against a public RPC is slow, rate-limited,
   and re-fetches on every page load. A dashboard listing "circles you're in" across dozens of
   clones needs a queryable index, not N parallel `eth_getLogs` calls per visitor.
2. **Someone has to be the VRF operator.** `Circle.sol`'s `requestDraw()` records intent on-chain,
   but *something* off-chain must actually call Gelato's VRF request API and later submit
   `fulfillRandomness`. That's a keeper process, not a browser tab that might be closed.
3. **Off-chain human touchpoints.** WhatsApp/email reminders ("your COMMIT deadline is in 6 hours"),
   the early-access/waitlist intake, and reputation/notification fan-out are not on-chain concerns.

Everything the backend does is **advisory and operational, never custodial** — if the whole backend
disappeared, member funds remain recoverable on-chain via `reclaimOnStall()` / `refundFilling()`
(architecture-spec §10). This is a hard design constraint: the backend must be able to die without
trapping anyone's money.

---

## 2. System diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              apps/web (Next.js)                            │
│  Landing · Dashboard · Circle view · Create wizard · Early-access          │
│  - Privy auth (embedded wallet)                                            │
│  - Direct viem reads for on-chain truth (tx status, live contract state)   │
│  - REST calls to apps/api for indexed/aggregated reads + off-chain writes  │
└───────────────┬───────────────────────────────────────┬────────────────────┘
                │ HTTPS (REST, JWT-authenticated)        │ viem (public RPC)
                ▼                                         ▼
┌───────────────────────────────┐          ┌──────────────────────────────────┐
│         apps/api (NestJS)     │          │        Monad Testnet/Mainnet      │
│  - AuthModule (Privy JWT      │◄────────►│  CircleFactory · Circle clones    │
│    verification)              │  viem    │  ReputationRegistry · MockStable  │
│  - CirclesModule (indexed     │          └──────────────────────────────────┘
│    read API: list/detail)             ▲
│  - WaitlistModule (early-             │ writeContract (keeper wallet only)
│    access intake)                     │
│  - NotificationsModule (enqueue)      │
│  - HealthModule                       │
└───────┬─────────────┬─────────────────┘
        │             │
        │ SQL         │ enqueue jobs
        ▼             ▼
┌───────────────┐   ┌─────────────────────────────────────────────────────┐
│   Postgres    │   │                  Redis + BullMQ                    │
│  (packages/db)│   │  Queues: indexer · vrf-keeper · notify · reminders  │
└───────▲───────┘   └───┬──────────────┬──────────────┬──────────────────┘
        │                │              │              │
        │ writes          ▼              ▼              ▼
        │        ┌───────────────┐ ┌───────────┐ ┌──────────────────┐
        └────────│ Indexer Worker│ │VRF Keeper │ │ Notify Worker     │
                  │ (apps/workers)│ │ Worker    │ │ (WhatsApp/email)  │
                  │ getLogs/watch │ │ Gelato VRF│ │ Twilio/Meta Cloud │
                  │ → Postgres    │ │ request + │ │ API + Resend/SES  │
                  └───────┬───────┘ │ fulfill   │ └──────────────────┘
                          │         │ tx submit │
                          ▼         └─────┬─────┘
                    Monad RPC              ▼
                    (read logs)      Monad RPC (write, keeper EOA)
```

All three workers (indexer, VRF keeper, notifier) and the API share `packages/db` (Prisma schema +
client) and `packages/shared` (ABIs/addresses) — no logic duplicated between the on-chain read/write
paths used by the frontend and those used by the backend.

---

## 3. Monorepo layout (additions)

Extends the existing pnpm-workspace + Turborepo structure. New pieces in **bold**:

```
bhishi/
├─ apps/
│  ├─ web/                     # existing — Next.js frontend
│  ├─ api/                     # NEW — NestJS REST API
│  └─ workers/                 # NEW — indexer, vrf-keeper, notifier processes
├─ packages/
│  ├─ contracts/                # existing — Foundry
│  ├─ shared/                   # existing — ABIs + addresses.ts
│  ├─ events/                   # existing — viem getLogs helper (reused by indexer)
│  └─ db/                       # NEW — Prisma schema + generated client, shared by api + workers
├─ infra/                       # NEW
│  ├─ docker-compose.yml        # local + single-VM prod: api, workers, postgres, redis
│  ├─ Dockerfile.api
│  ├─ Dockerfile.workers
│  └─ Dockerfile.web
├─ .github/workflows/           # NEW — CI (lint, typecheck, test, build, contract tests)
│  ├─ ci.yml
│  └─ deploy.yml
├─ scripts/demo.ts
├─ docs/{architecture-spec.md, production-architecture.md, THREAT-MODEL.md}
├─ turbo.json · pnpm-workspace.yaml
```

`packages/db` is the key new shared package: one Prisma schema, one migration history, consumed by
both `apps/api` (reads/writes via NestJS services) and `apps/workers` (indexer writes, keeper reads
job state). This avoids the classic problem of two services drifting on what a "circle" row means.

---

## 4. `apps/api` — NestJS service

Chosen over tRPC/Fastify because: (a) the team's other skill tooling already assumes Nest
conventions, (b) Nest's module/DI structure keeps `CirclesModule`, `WaitlistModule`,
`NotificationsModule` isolated with clear boundaries as the surface grows, (c) a REST/OpenAPI
surface is reusable if a native mobile client is ever added, not tied to Next.js like tRPC would be.

**Modules:**

| Module | Responsibility | Talks to |
|---|---|---|
| `AuthModule` | Verifies Privy JWTs (`@privy-io/server-auth`) on protected routes; attaches `userId`/wallet address to request context | Privy verification API |
| `CirclesModule` | `GET /circles`, `GET /circles/:address`, `GET /circles/:address/events` — serves indexed data from Postgres instead of live `getLogs` | Postgres (via `packages/db`) |
| `WaitlistModule` | `POST /waitlist` — replaces today's stub route; persists to Postgres, enqueues a `notify.welcome` job | Postgres, Redis/BullMQ |
| `NotificationsModule` | Internal — reads user notification preferences, exposes enqueue helpers used by other modules | Postgres, Redis/BullMQ |
| `HealthModule` | `GET /health` — liveness/readiness for Docker/orchestrator health checks | Postgres, Redis ping |

**What the API explicitly does NOT do:** it never holds a private key, never calls `writeContract`
for user actions (join/commit/reveal/create — those remain user-signed txs from the frontend via
Privy's embedded wallet, exactly as today), and never gates fund movement. Its only on-chain write
capability is delegated entirely to the VRF keeper worker (§6), which is a distinct process with its
own scoped credential — not reachable through any HTTP endpoint.

**Auth model:** Privy issues a JWT to the authenticated browser session; the frontend forwards it as
a Bearer token; `AuthModule` verifies it server-side per request (closing the gap noted in the
current codebase, where auth state is client-only with no server-side verification anywhere).

---

## 5. Database — Postgres via `packages/db` (Prisma)

Postgres chosen over a NoSQL store because the data is inherently relational (circles → members →
rounds → events) and needs transactional writes from the indexer (an event must never be recorded
twice, and a round's state must update atomically with its event row).

**Core schema (sketch — refined during implementation):**

```prisma
model Circle {
  address       String   @id                // clone address, on-chain source of truth
  factoryTx     String
  organizer     String
  seats         Int
  contribution  Decimal
  bond          Decimal
  mode          String                       // DRAW | AUCTION
  state         String                       // mirrors Circle.sol FSM, updated by indexer
  createdAt     DateTime
  members       Member[]
  rounds        Round[]
  events        ChainEvent[]
}

model Member {
  id        String   @id @default(cuid())
  circle    Circle   @relation(fields: [circleAddress], references: [address])
  circleAddress String
  address   String
  joinedAt  DateTime
  hasWon    Boolean  @default(false)
  removed   Boolean  @default(false)
  @@unique([circleAddress, address])
}

model Round {
  id             String   @id @default(cuid())
  circle         Circle   @relation(fields: [circleAddress], references: [address])
  circleAddress  String
  roundNumber    Int
  phase          String                      // COMMIT | REVEAL | DRAW | PAYOUT | COMPLETED
  commitDeadline DateTime
  revealDeadline DateTime
  vrfRequestId   String?
  drawRequestedAt DateTime?
  winner         String?
  @@unique([circleAddress, roundNumber])
}

model ChainEvent {                            // append-only audit trail, mirrors §12 events
  id            String   @id @default(cuid())
  circle        Circle   @relation(fields: [circleAddress], references: [address])
  circleAddress String
  blockNumber   BigInt
  txHash        String
  logIndex      Int
  eventName     String
  payload       Json
  observedAt    DateTime @default(now())
  @@unique([txHash, logIndex])                // idempotent re-indexing
}

model WaitlistEntry {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String
  whatsapp       String
  tradition      String
  circleSize     Int
  trackingMethod String
  role           String                       // member | organiser
  wantsTryNow    Boolean  @default(false)
  createdAt      DateTime @default(now())
}

model NotificationLog {                       // delivery audit, dedup, retry backoff state
  id          String   @id @default(cuid())
  userAddress String
  channel     String                          // whatsapp | email
  kind        String                          // round_deadline | payout | slash | waitlist_welcome
  status      String                          // queued | sent | failed
  jobId       String?
  createdAt   DateTime @default(now())
}
```

**On-chain remains the source of truth.** Postgres is a derived, rebuildable cache: if wiped, the
indexer worker can fully reconstruct it from `getLogs` from genesis (or the factory's deploy block).
No business logic depends on Postgres alone — it exists for read performance and off-chain
convenience, never as the arbiter of fund state.

**Hosting:** managed Postgres (Neon or Supabase) even under the Docker-Compose deployment model —
running Postgres itself in a container on a single VM is fine for early-stage deployment, but a
managed instance is recommended once real user funds are involved, for backups/PITR without
operating that yourself. `infra/docker-compose.yml` supports both (a `postgres` service for
local/dev, `DATABASE_URL` override for managed prod).

---

## 6. Redis + BullMQ — queues and cache

**Why BullMQ over cron/setInterval:** the three background jobs (indexing, VRF keeping,
notifications) all need retries with backoff, deduplication (don't double-request VRF for the same
round if a worker restarts mid-flight), delayed scheduling (send the "6 hours left to COMMIT"
reminder at a computed future time, not by polling), and observability (a job's attempt count and
failure reason). BullMQ gives all of this for free on top of Redis; hand-rolled interval loops don't.

**Queues:**

| Queue | Producer | Consumer | Job examples |
|---|---|---|---|
| `indexer` | Cron trigger (every N blocks/seconds) inside the indexer worker itself | Indexer worker | `syncCircle(address)` — fetch new logs since last-indexed block, upsert into Postgres |
| `vrf-keeper` | Indexer worker, on detecting a round enter `DRAW` | VRF keeper worker | `requestVrf(circleAddress, round)`, `submitFulfillment(circleAddress, round, requestId)` |
| `notify` | API (`WaitlistModule`, and round-deadline scheduling triggered by indexer) | Notify worker | `sendWhatsapp(to, template, vars)`, `sendEmail(to, template, vars)` |
| `reminders` | Indexer worker, on a round entering COMMIT/REVEAL (schedules a delayed job for deadline − 6h) | Notify worker (via `notify` queue) | Delayed job that fires the actual send job |

**Redis also serves as a read cache:** `GET /circles/:address` responses are cached with a short TTL
(e.g. 10–30s) keyed on the circle's `state`, invalidated on the next indexed event for that circle —
cuts DB load for the dashboard's polling-heavy circle-view page without going stale across a phase
transition.

**Hosting:** Upstash (serverless Redis, pay-per-request) is a reasonable managed option even inside
the Docker-Compose model; a `redis` container works fine for the VM-hosted phase.

---

## 7. `apps/workers` — background processes

Three distinct worker roles, run as separate processes (separate BullMQ workers, separate Docker
containers) even though they can share one codebase/package for now — this keeps failure isolated
(a crashing notifier must never stall VRF keeping) and lets each scale/restart independently.

### 7.1 Indexer worker
- Polls (or ideally `viem`'s `watchContractEvent`, finally implementing the stub left in
  `packages/events/src/watchers.ts`) the `CircleFactory` for new `CircleCreated` events, and each
  known `Circle` clone for its round/lifecycle events (§12 of architecture-spec).
- Upserts into Postgres (`Circle`, `Member`, `Round`, `ChainEvent` — all idempotent on
  `(txHash, logIndex)`).
- On detecting a round transition into `DRAW` (i.e. `DrawRequestedAt` set on-chain but no
  `WinnerDrawn` yet), enqueues a `vrf-keeper` job.
- On detecting `COMMIT`/`REVEAL` phase start, enqueues a delayed `reminders` job for deadline − 6h.

### 7.2 VRF keeper worker — **this is the authorized `vrfOperator`**
- Holds its own dedicated signing key — a scoped EOA, funded only with gas for VRF-fulfillment
  transactions, held as an encrypted environment variable/secret on the deploy platform (never
  shared with the API, never the same key as any user wallet). This is the pragmatic, right-sized
  choice for the current stage: the key's blast radius is bounded (see below), so a dedicated
  secrets-manager/HSM integration is deferred until real mainnet value is at stake — the
  architecture is already structured so that upgrade is a credential-storage swap, not a redesign.
- On a `requestVrf` job: calls Gelato's VRF request API for the given circle+round, records the
  Gelato-returned request handle in Postgres (`Round.vrfRequestId`).
- On Gelato's callback/webhook (or by polling Gelato's status endpoint if no webhook is used),
  submits the `fulfillRandomness(requestId, randomness)` transaction on-chain via `viem`
  `writeContract`, signed by the keeper key.
- **Idempotency guard:** before submitting, worker checks on-chain `hasWon`/round state — if
  already fulfilled (e.g. a previous worker instance already submitted), skip. Never double-submit.
- **This worker can die without stranding funds:** if it never gets to fulfillment,
  `Circle.sol`'s `VRF_TIMEOUT` → `STALLED` → permissionless `reclaimOnStall()` is the safety net
  (architecture-spec §6, §10). The keeper is a liveness *convenience*, not a trust dependency —
  even total key compromise only lets an attacker submit a bad-faith fulfillment (still bounded by
  contract logic) or withhold one (already mitigated by the timeout/reclaim path), never move funds
  directly. This is what makes the lightweight key-storage choice above safe at this stage.
- Retries with exponential backoff (BullMQ default) for transient RPC/Gelato failures; alerts (see
  §9) if a request approaches `VRF_TIMEOUT` unfulfilled, so a human can investigate before members
  are forced into the stall/reclaim path.

### 7.3 Notify worker
- Consumes `notify` queue jobs: WhatsApp via Meta's WhatsApp Cloud API (or Twilio's WhatsApp API as
  a simpler on-ramp) using the number captured in `WaitlistEntry`/user profile; email via
  Resend/SES for anything email-based.
- Templates: `waitlist_welcome`, `round_deadline_reminder`, `payout_received`, `slash_notice`.
- Writes to `NotificationLog` for delivery status/audit, and to dedupe (don't resend the same
  reminder if a job retries).

---

## 8. Deployment — Docker Compose on a VM

Matches the hackathon→early-production trajectory: one `docker-compose.yml` under `infra/` runs
everything colocated on a single VM (Railway, Fly.io, a DigitalOcean droplet, or a bare EC2
instance), with a clear path to peel services out to managed offerings as load grows — without a
rewrite, since each service is already containerized and stateless (state lives in Postgres/Redis,
not in-process).

```yaml
# infra/docker-compose.yml (shape)
services:
  web:        # Next.js frontend — could also be deployed separately on Vercel instead
    build: { context: .., dockerfile: infra/Dockerfile.web }
    env_file: .env
    ports: ["3000:3000"]

  api:        # NestJS
    build: { context: .., dockerfile: infra/Dockerfile.api }
    env_file: .env
    ports: ["4000:4000"]
    depends_on: [postgres, redis]

  worker-indexer:
    build: { context: .., dockerfile: infra/Dockerfile.workers }
    command: ["node", "dist/indexer.js"]
    env_file: .env
    depends_on: [postgres, redis]

  worker-vrf-keeper:
    build: { context: .., dockerfile: infra/Dockerfile.workers }
    command: ["node", "dist/vrf-keeper.js"]
    env_file: .env.keeper       # separate secrets file — isolates the signing key
    depends_on: [postgres, redis]

  worker-notify:
    build: { context: .., dockerfile: infra/Dockerfile.workers }
    command: ["node", "dist/notify.js"]
    env_file: .env
    depends_on: [postgres, redis]

  postgres:   # dev/small-scale prod only — swap for managed Neon/Supabase via DATABASE_URL
    image: postgres:16-alpine
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:      # dev/small-scale prod only — swap for managed Upstash via REDIS_URL
    image: redis:7-alpine

volumes:
  pgdata:
```

Each Dockerfile is a standard multi-stage Node build (pnpm install → turbo build --filter=<app> →
copy `dist/` + `node_modules` into a slim runtime image), using Turborepo's filtered builds so the
`web` image doesn't bundle NestJS and vice versa.

**Why Docker Compose (not bare Kubernetes) at this stage:** it gets the full multi-service topology
— API, three workers, database, cache — running identically in local dev and production with one
config file, which is exactly what's needed to demonstrate a real, coherent production
architecture. The layout is intentionally k8s-portable later (one Deployment per service, one
Service per exposed port) if/when genuine scale calls for that additional orchestration layer.

---

## 9. Observability & CI/CD

**CI (`.github/workflows/ci.yml`)** — currently nonexistent, first gap to close:
- `pnpm install` → `turbo run lint typecheck test build` across all apps/packages (parallelized,
  cached via Turborepo remote cache).
- `forge test` for `packages/contracts` (including the fuzz/invariant suite already written).
- Blocks merge on any failure — closes the "no CI configured" gap noted in the current-state audit.

**CD (`.github/workflows/deploy.yml`)**:
- On merge to main: build+push Docker images (GHCR), SSH/deploy-hook to the VM to
  `docker compose pull && docker compose up -d`, run `prisma migrate deploy` against the target DB
  before swapping containers.
- Contract deploys stay a deliberate, manual `forge script ... --broadcast --verify` step (never
  automated) — a fund-custodying deploy should never be a side effect of a green CI run.

**Observability:**
- `HealthModule`'s `/health` wired to the VM's process supervisor / Compose healthchecks for
  auto-restart.
- Structured logs (pino) from API + all three workers, shipped to a log aggregator (even a simple
  hosted option like Axiom/Better Stack is enough pre-scale) — critical for the VRF keeper
  specifically, since a silent keeper failure degrades UX (forces members into the stall/reclaim
  path) even though it can't lose funds.
- Alert (Slack/Discord webhook, or PagerDuty later) on: a `vrf-keeper` job failing all retries, a
  round approaching `VRF_TIMEOUT` unfulfilled, or the indexer falling more than N blocks behind
  chain head.

---

## 10. Migration path from today's state

Ordered, each step independently shippable:

1. Add `packages/db` (Prisma schema above) + migration; point `WaitlistModule`'s future home at it.
2. Stand up `apps/api` with just `WaitlistModule` + `HealthModule`; swap the existing
   `apps/web/src/app/api/waitlist/route.ts` stub to call it (or retire the Next.js route entirely
   and have the frontend call `apps/api` directly — recommended, since Next.js API routes and a real
   backend shouldn't both own the same concern long-term).
3. Add the indexer worker + `CirclesModule`; migrate the dashboard/circle-view pages from raw
   client-side `getLogs` to the indexed API, keeping viem reads only for real-time
   tx-status/confirmation UX.
4. Add the VRF keeper worker once contracts are deployed with real (non-zero) addresses and a
   `vrfOperator` is set to the keeper's address at deploy time.
5. Add the notify worker + reminder scheduling.
6. Wire CI, then CD, then containerize via `infra/`.

This order front-loads the parts needed for the earlier-committed early-access/waitlist flow, then
layers in indexing, then the keeper — each usable independently rather than needing a big-bang cutover.
