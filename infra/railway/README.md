# Railway service configs

Railway's auto-detected Nixpacks build doesn't run `prisma generate` before
building `apps/api` / `apps/workers`, so the build fails with "Property X does
not exist on type PrismaService" (the client is never generated). These files
tell Railway to build with the existing `infra/Dockerfile.*` instead, which
already run `pnpm --filter @bhishi/db generate` first.

One Railway project, 4 services, all from this one repo:

| Service | Root directory | Config File Path (Settings → Build) |
|---|---|---|
| `api` | `/` | `infra/railway/api.json` |
| `web` | `/` | `infra/railway/web.json` |
| `worker-indexer` | `/` | `infra/railway/worker-indexer.json` |
| `worker-notify` | `/` | `infra/railway/worker-notify.json` |

`worker-indexer` and `worker-notify` build the exact same image
(`infra/Dockerfile.workers`) — they're two services only so each runs its own
process (`indexer.js` vs `notify.js`) and a crash in one never stalls the
other.

Also add a managed **Postgres** and **Redis** plugin to the project, then
reference them from each service's variables as `${{Postgres.DATABASE_URL}}`
/ `${{Redis.REDIS_URL}}`.

Run migrations once before first deploy (and safe to re-run on every deploy
after, `migrate deploy` is idempotent):

```
pnpm --filter @bhishi/db exec prisma migrate deploy
```

Not deployed yet: `vrf-keeper` (`apps/workers` `start:keeper` script) — its
source file (`src/vrf-keeper.ts`) doesn't exist in the repo yet.
