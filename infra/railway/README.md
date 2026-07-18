# Railway service configs

Railway auto-detected this monorepo and created one service per app
(`apps/api`, `apps/web`, `apps/workers`), each with **Root Directory** already
set to that subfolder. That's the right shape — leave Root Directory as-is.

The one thing auto-detect can't know: `apps/api` and `apps/workers` both
import the generated Prisma client from `@bhishi/db`, and nothing runs
`prisma generate` before the build. That's why a fresh build fails with
`Property 'X' does not exist on type 'PrismaService'` — the client was never
generated. `pnpm --filter <pkg>` still resolves the whole workspace correctly
even when Root Directory is a subfolder, so the fix is just prepending the
generate step to each service's build command.

For each service, go to **Settings → Build → Config File Path** and point it
at the matching file here (Railway will read the build/start commands from
it, no manual field editing needed):

| Service | Root directory (leave as auto-detected) | Config File Path |
|---|---|---|
| `api` | `/apps/api` | `infra/railway/api.json` |
| `web` | `/apps/web` | `infra/railway/web.json` |
| `worker-indexer` | `/apps/workers` | `infra/railway/worker-indexer.json` |
| `worker-notify` | `/apps/workers` | `infra/railway/worker-notify.json` |

`apps/workers` needs to become **two** Railway services (duplicate the
auto-detected one) — same root directory, same code, but each with a
different start command (`indexer.js` vs `notify.js`) so a crash in the
notifier (e.g. a Twilio outage) never stalls chain indexing.

Also add a managed **Postgres** and **Redis** plugin to the project, then
reference them from each service's variables as `${{Postgres.DATABASE_URL}}`
/ `${{Redis.REDIS_URL}}`.

Run migrations once before first deploy (safe to leave running on every
deploy after — `migrate deploy` is idempotent):

```
pnpm --filter @bhishi/db exec prisma migrate deploy
```

Not deployed yet: `vrf-keeper` (`apps/workers` `start:keeper` script) — its
source file (`src/vrf-keeper.ts`) doesn't exist in the repo yet.

## If you'd rather use the existing Dockerfiles instead

`infra/Dockerfile.api` / `infra/Dockerfile.workers` already do the same
`prisma generate` step, and are a bit more reproducible than Nixpacks. To use
them you'd need to change each service's **Root Directory to `/`** (repo
root) instead of the auto-detected subfolder, since the Dockerfiles expect to
see the whole workspace. Not necessary — the Nixpacks configs above work fine
without touching Root Directory.
