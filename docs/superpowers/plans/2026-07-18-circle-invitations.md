# Circle Invitations & Invite-Gated Join — Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a circle creator invite people by email (real emails via Resend) and by a reusable, capacity-bounded shareable link, gated so invited new users register (Privy sign-in) then land on the join step.

**Architecture:** New Prisma `Invite` model + two NestJS modules — `EmailModule` (Resend wrapper with console fallback when no API key) and `InvitesModule` (mint/validate/consume tokens, creator-only guard). Link validity is computed from indexed member count vs `Circle.seats` (no drift). Frontend adds an email field to the CreateWizard, a copyable invite panel on the circle page, and `?invite=<token>` handling in `CircleView` that routes authenticated → join, new → AuthGate → join → consume. On-chain remains the source of truth; tokens gate UI/attribution only.

**Tech Stack:** NestJS 11, Prisma 6 (`@bhishi/db`), class-validator DTOs, `resend` npm pkg, Next.js App Router (client components), viem, Privy, Jest.

**Design doc:** `docs/superpowers/specs/2026-07-18-circle-invitations-design.md`

**Conventions to follow (from the existing codebase):**
- Addresses are stored/compared **lowercased** everywhere (see `Member.address`, `circles.service.ts`).
- Auth-guarded routes read the wallet from `req.user.walletAddress` (verified Privy session), **never** the body (see `sponsor.controller.ts`).
- Optional env vars use `@IsString() @IsOptional()` in `config/env.validation.ts`.
- Service unit tests mock `PrismaService` with a partial object (see `waitlist.service.spec.ts`).
- Frontend API calls go through `apiUrl()` from `@/lib/api`; auth token via `getAccessToken()` from `usePrivy()`.
- The member identity + tx sender comes from `useMember()` (`address`, `write`) — never read a wallet any other way.

---

## Chunk 1: Data model & Email service

### Task 1: Add the `Invite` model + enums to the Prisma schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append after the `NotificationLog` model, before `IndexerCursor`)

- [ ] **Step 1: Add enums and model**

Append to `packages/db/prisma/schema.prisma`:

```prisma
/// Off-chain invitation to a circle. On-chain is open (anyone can join), so an
/// Invite gates the *UI/attribution*, never the contract. Two kinds:
///  - LINK: one reusable link per circle the creator shares with a group.
///  - EMAIL: one token per invited email, sent via Resend at creation time.
/// Validity is capacity-bounded: a LINK/EMAIL token is only "valid" while the
/// circle still has open seats (indexed member count < Circle.seats and the
/// circle is still FILLING). Computed at validation time — no counter to drift.
enum InviteKind {
  LINK
  EMAIL
}

enum InviteStatus {
  PENDING
  CONSUMED
  REVOKED
}

model Invite {
  id            String       @id @default(cuid())
  /// URL-safe random token (crypto.randomBytes(24).toString('base64url')). Unique.
  token         String       @unique
  circle        Circle       @relation(fields: [circleAddress], references: [address], onDelete: Cascade)
  circleAddress String
  kind          InviteKind
  /// Present for EMAIL invites; null for the general LINK.
  email         String?
  /// Creator's lowercased wallet address (the only role allowed to invite).
  invitedBy     String
  status        InviteStatus @default(PENDING)
  /// Lowercased address that consumed it, set on first join via the link.
  consumedBy    String?
  consumedAt    DateTime?
  createdAt     DateTime     @default(now())

  @@index([circleAddress])
  @@index([email])
}
```

- [ ] **Step 2: Add the back-relation on `Circle`**

In the `Circle` model, add `invites Invite[]` alongside the existing relations:

```prisma
  members Member[]
  rounds  Round[]
  events  ChainEvent[]
  invites Invite[]
```

- [ ] **Step 3: Create the migration and regenerate the client**

Run: `pnpm --filter @bhishi/db exec prisma migrate dev --name add_invite`
Expected: a new migration folder under `packages/db/prisma/migrations/`, and "Your database is now in sync" + client regenerated.
(If no dev DB is available, run `pnpm --filter @bhishi/db exec prisma generate` and note the migration must be run in the target env before deploy.)

- [ ] **Step 4: Typecheck the db package**

Run: `pnpm --filter @bhishi/db typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Invite model for circle invitations"
```

---

### Task 2: Add email env vars to validation

**Files:**
- Modify: `apps/api/src/config/env.validation.ts`

- [ ] **Step 1: Add three optional vars to `EnvironmentVariables`**

After the `SPONSOR_DAILY_CAP` field, add:

```typescript
  /** Resend API key for sending invite emails. If unset, the EmailService logs
   *  the email to the console instead of sending (local-dev friendly). */
  @IsString()
  @IsOptional()
  RESEND_API_KEY?: string;

  /** From-address for invite emails. Defaults to Resend's shared onboarding
   *  sender so it works before a domain is verified. */
  @IsString()
  @IsOptional()
  EMAIL_FROM?: string;

  /** Public origin of the web app, used to build invite links in emails.
   *  Defaults to localhost for dev. */
  @IsString()
  @IsOptional()
  PUBLIC_WEB_URL?: string;
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/config/env.validation.ts
git commit -m "feat(api): add Resend/email env vars"
```

---

### Task 3: EmailService (Resend wrapper with console fallback)

**Files:**
- Create: `apps/api/src/email/email.service.ts`
- Create: `apps/api/src/email/email.module.ts`
- Test: `apps/api/src/email/email.service.spec.ts`
- Modify: `apps/api/package.json` (add `resend` dependency)

- [ ] **Step 1: Add the `resend` dependency**

Run: `pnpm --filter @bhishi/api add resend`
Expected: `resend` appears in `apps/api/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/email/email.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

describe('EmailService', () => {
  const create = jest.fn();
  let logSpy: jest.SpyInstance;

  async function make(config: Record<string, string | undefined>) {
    create.mockReset().mockResolvedValue({ id: 'log_1' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: { get: (k: string) => config[k] } },
        { provide: PrismaService, useValue: { notificationLog: { create } } },
      ],
    }).compile();
    return moduleRef.get(EmailService);
  }

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it('falls back to console logging when RESEND_API_KEY is unset, and still audits', async () => {
    const svc = await make({ RESEND_API_KEY: undefined });
    await svc.sendCircleInvite({
      to: 'a@b.com',
      circleAddress: '0xabc',
      inviteUrl: 'http://localhost:3000/circle/0xabc?invite=tok',
      inviter: '0xdead',
    });
    // Console fallback used.
    expect(logSpy).toHaveBeenCalled();
    // NotificationLog written with the invite kind, marked sent.
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0].data;
    expect(arg.channel).toBe('email');
    expect(arg.kind).toBe('circle_invite');
    expect(arg.email).toBe('a@b.com');
    expect(arg.status).toBe('sent');
  });

  it('records status=failed when the underlying send throws', async () => {
    // No API key → console path; force console.log to throw to exercise the
    // failure branch (the send is wrapped in try/catch and must still audit).
    logSpy.mockImplementation(() => { throw new Error('boom'); });
    const svc = await make({ RESEND_API_KEY: undefined });
    await svc.sendCircleInvite({
      to: 'a@b.com',
      circleAddress: '0xabc',
      inviteUrl: 'http://localhost:3000/circle/0xabc?invite=tok',
      inviter: '0xdead',
    });
    const arg = create.mock.calls[0][0].data;
    expect(arg.status).toBe('failed');
    expect(arg.error).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @bhishi/api test -- email.service`
Expected: FAIL — cannot find `./email.service`.

- [ ] **Step 4: Implement `EmailService`**

Create `apps/api/src/email/email.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';

export interface CircleInviteEmail {
  to: string;
  circleAddress: string;
  inviteUrl: string;
  /** Inviter's wallet address, shown in the email body for context. */
  inviter: string;
}

/**
 * Sends transactional email via Resend. When RESEND_API_KEY is unset (local
 * dev), it logs the email that WOULD have been sent instead of failing — so the
 * whole invite flow works end-to-end with no external dependency. Every attempt
 * is recorded in NotificationLog for audit/dedup, matching the notify worker.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const key = this.config.get<string>('RESEND_API_KEY');
    this.resend = key ? new Resend(key) : null;
    this.from = this.config.get<string>('EMAIL_FROM') ?? 'Bhishi <onboarding@resend.dev>';
  }

  async sendCircleInvite(email: CircleInviteEmail): Promise<void> {
    const subject = 'You’re invited to a Bhishi savings circle';
    const html = this.renderHtml(email);
    const text =
      `You've been invited to join a Bhishi circle.\n\n` +
      `Open this link to join: ${email.inviteUrl}\n\n` +
      `Circle: ${email.circleAddress}\nInvited by: ${email.inviter}`;

    let status = 'sent';
    let errorMsg: string | undefined;
    try {
      if (this.resend) {
        await this.resend.emails.send({ from: this.from, to: email.to, subject, html, text });
      } else {
        // Console fallback — no API key configured.
        this.logger.log(`[email:fallback] to=${email.to} url=${email.inviteUrl}`);
        // eslint-disable-next-line no-console
        console.log(`\n--- INVITE EMAIL (no RESEND_API_KEY) ---\nTo: ${email.to}\n${text}\n---\n`);
      }
    } catch (e) {
      status = 'failed';
      errorMsg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to send invite to ${email.to}: ${errorMsg}`);
    }

    await this.prisma.notificationLog.create({
      data: {
        email: email.to,
        channel: 'email',
        kind: 'circle_invite',
        status,
        error: errorMsg ?? null,
        sentAt: status === 'sent' ? new Date() : null,
      },
    });
  }

  private renderHtml(email: CircleInviteEmail): string {
    return `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>You’re invited to a Bhishi circle</h2>
        <p>Someone invited you to join a rotating savings circle on Bhishi.</p>
        <p><a href="${email.inviteUrl}" style="display:inline-block;padding:12px 20px;background:#0b0b0e;color:#faf9f6;text-decoration:none;border-radius:4px;">Join the circle</a></p>
        <p style="color:#6b6470;font-size:12px;">Or paste this link: ${email.inviteUrl}</p>
        <p style="color:#6b6470;font-size:12px;">Circle: ${email.circleAddress}</p>
      </div>`;
  }
}
```

- [ ] **Step 5: Create the module**

Create `apps/api/src/email/email.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @bhishi/api test -- email.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/email apps/api/package.json ../../pnpm-lock.yaml
git commit -m "feat(api): EmailService with Resend + console fallback"
```

---

## Chunk 2: InvitesModule (mint / validate / consume)

### Task 4: DTO for creating invites

**Files:**
- Create: `apps/api/src/invites/dto/create-invites.dto.ts`

- [ ] **Step 1: Write the DTO**

Create `apps/api/src/invites/dto/create-invites.dto.ts`:

```typescript
import { ArrayMaxSize, IsArray, IsEmail, IsEthereumAddress, IsOptional } from 'class-validator';

export class CreateInvitesDto {
  /** The circle to invite to. Must be a circle the caller created. */
  @IsEthereumAddress()
  circleAddress!: string;

  /** Optional list of emails to invite. Empty/omitted → only the LINK is minted. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  emails?: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/invites/dto/create-invites.dto.ts
git commit -m "feat(api): CreateInvitesDto"
```

---

### Task 5: InvitesService — mint, validate, consume

**Files:**
- Create: `apps/api/src/invites/invites.service.ts`
- Test: `apps/api/src/invites/invites.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/invites/invites.service.spec.ts`:

```typescript
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { InvitesService } from './invites.service';

describe('InvitesService', () => {
  const circleFindUnique = jest.fn();
  const memberCount = jest.fn();
  const inviteFindFirst = jest.fn();
  const inviteFindUnique = jest.fn();
  const inviteCreate = jest.fn();
  const inviteUpdate = jest.fn();
  const sendCircleInvite = jest.fn();

  async function make() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        InvitesService,
        { provide: ConfigService, useValue: { get: () => 'http://localhost:3000' } },
        { provide: EmailService, useValue: { sendCircleInvite } },
        {
          provide: PrismaService,
          useValue: {
            circle: { findUnique: circleFindUnique },
            member: { count: memberCount },
            invite: {
              findFirst: inviteFindFirst,
              findUnique: inviteFindUnique,
              create: inviteCreate,
              update: inviteUpdate,
            },
          },
        },
      ],
    }).compile();
    return moduleRef.get(InvitesService);
  }

  beforeEach(() => {
    [circleFindUnique, memberCount, inviteFindFirst, inviteFindUnique, inviteCreate, inviteUpdate, sendCircleInvite]
      .forEach(m => m.mockReset());
    circleFindUnique.mockResolvedValue({ address: '0xcircle', creator: '0xcreator', seats: 2, state: 'FILLING' });
    memberCount.mockResolvedValue(0);
    inviteFindFirst.mockResolvedValue(null);
    inviteCreate.mockImplementation(({ data }: any) => Promise.resolve({ ...data }));
  });

  it('rejects a caller who is not the circle creator', async () => {
    const svc = await make();
    await expect(
      svc.createInvites({ circleAddress: '0xCircle' }, '0xnotcreator'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('mints a reusable LINK (idempotent) and one token per email, and sends each email', async () => {
    const svc = await make();
    const res = await svc.createInvites(
      { circleAddress: '0xCircle', emails: ['a@b.com', 'c@d.com'] },
      '0xCreator', // mixed case — must be lowercased before the creator check
    );
    // One LINK + two EMAIL rows created.
    const kinds = inviteCreate.mock.calls.map(c => c[0].data.kind);
    expect(kinds.filter(k => k === 'LINK')).toHaveLength(1);
    expect(kinds.filter(k => k === 'EMAIL')).toHaveLength(2);
    // Emails sent for each address.
    expect(sendCircleInvite).toHaveBeenCalledTimes(2);
    // Response carries a link URL and per-email URLs.
    expect(res.linkUrl).toContain('/circle/0xcircle?invite=');
    expect(res.invited).toHaveLength(2);
  });

  it('reuses an existing LINK instead of minting a second one', async () => {
    inviteFindFirst.mockImplementation(({ where }: any) =>
      where.kind === 'LINK' ? Promise.resolve({ token: 'existing', kind: 'LINK' }) : Promise.resolve(null),
    );
    const svc = await make();
    const res = await svc.createInvites({ circleAddress: '0xCircle' }, '0xcreator');
    expect(inviteCreate.mock.calls.filter(c => c[0].data.kind === 'LINK')).toHaveLength(0);
    expect(res.linkUrl).toContain('invite=existing');
  });

  it('validate() returns full=reason when the circle has no open seats', async () => {
    memberCount.mockResolvedValue(2); // seats = 2 → full
    inviteFindUnique.mockResolvedValue({ token: 't', circleAddress: '0xcircle', kind: 'LINK', status: 'PENDING' });
    const svc = await make();
    const res = await svc.validate('t');
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('full');
  });

  it('validate() returns valid while seats remain and circle is FILLING', async () => {
    inviteFindUnique.mockResolvedValue({ token: 't', circleAddress: '0xcircle', kind: 'LINK', status: 'PENDING' });
    const svc = await make();
    const res = await svc.validate('t');
    expect(res.valid).toBe(true);
    expect(res.circleAddress).toBe('0xcircle');
  });

  it('validate() returns unknown for a missing token', async () => {
    inviteFindUnique.mockResolvedValue(null);
    const svc = await make();
    const res = await svc.validate('missing');
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('unknown');
  });

  it('consume() marks an EMAIL token CONSUMED with lowercased consumer', async () => {
    inviteFindUnique.mockResolvedValue({ token: 't', circleAddress: '0xcircle', kind: 'EMAIL', status: 'PENDING', consumedBy: null, consumedAt: null });
    const svc = await make();
    await svc.consume('t', '0xJOINER');
    expect(inviteUpdate).toHaveBeenCalledTimes(1);
    const arg = inviteUpdate.mock.calls[0][0];
    expect(arg.data.status).toBe('CONSUMED');
    expect(arg.data.consumedBy).toBe('0xjoiner');
  });

  it('consume() keeps a LINK PENDING (reusable) but records the first consumer', async () => {
    inviteFindUnique.mockResolvedValue({ token: 't', circleAddress: '0xcircle', kind: 'LINK', status: 'PENDING', consumedBy: null, consumedAt: null });
    const svc = await make();
    await svc.consume('t', '0xJOINER');
    const arg = inviteUpdate.mock.calls[0][0];
    // LINK must NOT flip to CONSUMED, else validate() still passes but we'd have
    // lost the reusable semantics if it ever keyed off status.
    expect(arg.data.status).toBe('PENDING');
    expect(arg.data.consumedBy).toBe('0xjoiner');
  });

  it('consume() does not overwrite an existing LINK attribution on a later join', async () => {
    inviteFindUnique.mockResolvedValue({ token: 't', circleAddress: '0xcircle', kind: 'LINK', status: 'PENDING', consumedBy: '0xfirst', consumedAt: new Date(0) });
    const svc = await make();
    await svc.consume('t', '0xsecond');
    expect(inviteUpdate.mock.calls[0][0].data.consumedBy).toBe('0xfirst');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @bhishi/api test -- invites.service`
Expected: FAIL — cannot find `./invites.service`.

- [ ] **Step 3: Implement `InvitesService`**

Create `apps/api/src/invites/invites.service.ts`:

```typescript
import { randomBytes } from 'node:crypto';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateInvitesDto } from './dto/create-invites.dto';

type InvalidReason = 'unknown' | 'revoked' | 'full';

export interface ValidateResult {
  valid: boolean;
  circleAddress?: string;
  kind?: 'LINK' | 'EMAIL';
  status?: string;
  reason?: InvalidReason;
}

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  private webUrl(): string {
    return (this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  private buildUrl(circleAddress: string, token: string): string {
    return `${this.webUrl()}/circle/${circleAddress}?invite=${token}`;
  }

  private newToken(): string {
    return randomBytes(24).toString('base64url');
  }

  /**
   * Mint invites for a circle. Only the circle's creator may call this. Always
   * ensures a reusable LINK token exists (idempotent), and mints one EMAIL token
   * per address, sending each email best-effort. Circle addresses are lowercased
   * to match the indexed rows and the on-chain identity used everywhere.
   */
  async createInvites(dto: CreateInvitesDto, caller: string) {
    const circleAddress = dto.circleAddress.toLowerCase();
    const callerAddr = caller.toLowerCase();

    const circle = await this.prisma.circle.findUnique({ where: { address: circleAddress } });
    // The circle may not be indexed yet the instant after creation; treat a
    // missing row as "not the creator" is wrong, so require it to exist. The
    // frontend retries until the indexer has the row. If it exists, enforce
    // creator-only.
    if (!circle || circle.creator.toLowerCase() !== callerAddr) {
      throw new ForbiddenException('Only the circle creator can send invites');
    }

    // Idempotent LINK.
    let link = await this.prisma.invite.findFirst({ where: { circleAddress, kind: 'LINK' } });
    if (!link) {
      link = await this.prisma.invite.create({
        data: { token: this.newToken(), circleAddress, kind: 'LINK', invitedBy: callerAddr },
      });
    }

    const emails = dto.emails ?? [];
    const invited: { email: string; url: string }[] = [];
    for (const raw of emails) {
      const email = raw.trim().toLowerCase();
      if (!email) continue;
      let row = await this.prisma.invite.findFirst({ where: { circleAddress, kind: 'EMAIL', email } });
      if (!row) {
        row = await this.prisma.invite.create({
          data: { token: this.newToken(), circleAddress, kind: 'EMAIL', email, invitedBy: callerAddr },
        });
      }
      const url = this.buildUrl(circleAddress, row.token);
      await this.email.sendCircleInvite({ to: email, circleAddress, inviteUrl: url, inviter: callerAddr });
      invited.push({ email, url });
    }

    return { linkUrl: this.buildUrl(circleAddress, link.token), invited };
  }

  /**
   * Resolve a token for the frontend gate. Validity is capacity-bounded: the
   * token is only valid while the circle still has open seats AND is FILLING.
   * memberCount/seats come from the indexed rows, so this stays correct even for
   * a direct on-chain join.
   */
  async validate(token: string): Promise<ValidateResult> {
    const invite = await this.prisma.invite.findUnique({ where: { token } });
    if (!invite) return { valid: false, reason: 'unknown' };
    if (invite.status === 'REVOKED') {
      return { valid: false, reason: 'revoked', circleAddress: invite.circleAddress, kind: invite.kind };
    }

    const circle = await this.prisma.circle.findUnique({ where: { address: invite.circleAddress } });
    const memberCount = await this.prisma.member.count({ where: { circleAddress: invite.circleAddress } });
    const full = !circle || circle.state !== 'FILLING' || memberCount >= circle.seats;
    if (full) {
      return { valid: false, reason: 'full', circleAddress: invite.circleAddress, kind: invite.kind };
    }

    return { valid: true, circleAddress: invite.circleAddress, kind: invite.kind, status: invite.status };
  }

  /**
   * Best-effort attribution: mark the token CONSUMED and record who joined.
   * Never throws on business conditions — a failed consume must not block a join
   * that already succeeded on-chain.
   */
  async consume(token: string, joiner: string): Promise<void> {
    try {
      const invite = await this.prisma.invite.findUnique({ where: { token } });
      if (!invite) return;
      // A LINK is reusable up to `seats`, so flipping it to CONSUMED on the first
      // join would drop attribution for everyone after. Record the first consumer
      // but only mark EMAIL (one-shot) tokens CONSUMED; LINK stays PENDING and its
      // validity is governed by seat count in validate(), not this status.
      if (invite.kind === 'EMAIL' && invite.status === 'CONSUMED') return;
      const alreadyAttributed = invite.consumedBy != null;
      await this.prisma.invite.update({
        where: { token },
        data: {
          status: invite.kind === 'EMAIL' ? 'CONSUMED' : invite.status,
          // First consumer wins attribution; don't overwrite on later link joins.
          consumedBy: alreadyAttributed ? invite.consumedBy : joiner.toLowerCase(),
          consumedAt: alreadyAttributed ? invite.consumedAt : new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(`consume(${token}) failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @bhishi/api test -- invites.service`
Expected: PASS (all 9).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/invites/invites.service.ts apps/api/src/invites/invites.service.spec.ts
git commit -m "feat(api): InvitesService (mint/validate/consume, creator-only, seat-bounded)"
```

---

### Task 6: InvitesController + module wiring

**Files:**
- Create: `apps/api/src/invites/invites.controller.ts`
- Create: `apps/api/src/invites/invites.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the controller**

Create `apps/api/src/invites/invites.controller.ts`:

```typescript
import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthedRequest, PrivyAuthGuard } from '../auth/privy-auth.guard';
import { CreateInvitesDto } from './dto/create-invites.dto';
import { InvitesService } from './invites.service';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /** Mint the reusable LINK + per-email tokens and send the emails. Creator-only:
   *  the wallet is read from the verified session, never the body. */
  @Post()
  @UseGuards(PrivyAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(@Req() req: AuthedRequest, @Body() dto: CreateInvitesDto) {
    const wallet = req.user?.walletAddress;
    if (!wallet) throw new BadRequestException('No wallet linked to this account yet');
    return this.invites.createInvites(dto, wallet);
  }

  /** Public: resolve a token so the frontend gate knows where to route. */
  @Get(':token')
  validate(@Param('token') token: string) {
    return this.invites.validate(token);
  }

  /** Attribution after a successful join. Authenticated so we trust the joiner. */
  @Post(':token/consume')
  @UseGuards(PrivyAuthGuard)
  async consume(@Req() req: AuthedRequest, @Param('token') token: string) {
    const wallet = req.user?.walletAddress;
    if (!wallet) throw new BadRequestException('No wallet linked to this account yet');
    await this.invites.consume(token, wallet);
    return { ok: true };
  }
}
```

- [ ] **Step 2: Write the module**

Create `apps/api/src/invites/invites.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  imports: [EmailModule],
  controllers: [InvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
```

- [ ] **Step 3: Register in `app.module.ts`**

Add the import and include `InvitesModule` in the `imports` array (after `SponsorModule`):

```typescript
import { InvitesModule } from './invites/invites.module';
```
```typescript
    SponsorModule,
    InvitesModule,
```

- [ ] **Step 4: Build the API to verify wiring**

Run: `pnpm --filter @bhishi/api build`
Expected: no errors.

- [ ] **Step 5: Run the full API test suite**

Run: `pnpm --filter @bhishi/api test`
Expected: all pass (existing + new email/invites specs).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/invites/invites.controller.ts apps/api/src/invites/invites.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): InvitesController + wire InvitesModule"
```

---

## Chunk 3: Frontend — invite client, CreateWizard email field, circle-page invite panel, gated join

### Task 7: Frontend invites API helper

**Files:**
- Create: `apps/web/src/lib/invites.ts`

- [ ] **Step 1: Write the helper**

Create `apps/web/src/lib/invites.ts`:

```typescript
import { apiUrl } from './api';

export interface ValidateResult {
  valid: boolean;
  circleAddress?: string;
  kind?: 'LINK' | 'EMAIL';
  status?: string;
  reason?: 'unknown' | 'revoked' | 'full';
}

export interface CreateInvitesResult {
  linkUrl: string;
  invited: { email: string; url: string }[];
}

/** Mint the reusable link + email tokens for a circle. Requires an auth token. */
export async function createInvites(
  token: string | null,
  circleAddress: string,
  emails: string[],
): Promise<CreateInvitesResult> {
  const res = await fetch(apiUrl('/api/invites'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ circleAddress, emails }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Invite failed (${res.status})`);
  }
  return res.json();
}

/** Public token resolution for the invite-gated landing. */
export async function validateInvite(inviteToken: string): Promise<ValidateResult> {
  const res = await fetch(apiUrl(`/api/invites/${inviteToken}`));
  if (!res.ok) return { valid: false, reason: 'unknown' };
  return res.json();
}

/** Best-effort attribution after a successful join. Never throw to the caller. */
export async function consumeInvite(token: string | null, inviteToken: string): Promise<void> {
  try {
    await fetch(apiUrl(`/api/invites/${inviteToken}/consume`), {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    /* attribution is non-critical */
  }
}

/** Split a free-text email field on commas/whitespace/newlines into clean addrs. */
export function parseEmails(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,;]+/)
        .map(s => s.trim().toLowerCase())
        .filter(s => s.includes('@')),
    ),
  );
}
```

- [ ] **Step 2: Typecheck the web app**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors (helper is standalone).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/invites.ts
git commit -m "feat(web): invites API client + parseEmails"
```

---

### Task 8: Add the "Invite by email" field to CreateWizard

**Files:**
- Modify: `apps/web/src/components/CreateWizard.tsx`

**Context:** `CreateWizard` already has the create tx and calls `onSuccess(newAddr)`. We add an optional emails textarea, and after `newAddr` is known, POST the invites (best-effort — the circle exists on-chain regardless). `onSuccess` signature is unchanged, so the dashboard's auto-navigation stays.

- [ ] **Step 1: Add imports and state**

At the top imports, add:
```typescript
import { createInvites, parseEmails } from '@/lib/invites';
```
In the component state block (near the other `useState`s), add:
```typescript
  const [inviteEmails, setInviteEmails] = useState('');
```

- [ ] **Step 2: Fire invites after the circle address is recovered**

In `handleCreate`, immediately after the existing:
```typescript
      if (!newAddr) throw new Error('Circle created but address not found in logs');
```
add (before `onSuccess?.(newAddr);`):
```typescript
      // Mint the reusable share link + send any email invites. Best-effort: the
      // circle already exists on-chain, so a failure here must not block success.
      // The indexer may not have the Circle row for a beat, so retry briefly —
      // the creator-only check on the API reads the indexed creator field.
      try {
        const token = await getAccessToken();
        const emails = parseEmails(inviteEmails);
        for (let i = 0; i < 5; i++) {
          try {
            await createInvites(token, newAddr, emails);
            break;
          } catch (inviteErr: any) {
            if (i === 4) throw inviteErr;
            await new Promise(r => setTimeout(r, 1500));
          }
        }
      } catch (inviteErr) {
        console.warn('Invite send failed (non-fatal):', inviteErr);
      }
```

- [ ] **Step 3: Add the emails field to the form UI**

After the Bond input block (the `<div>` ending the bond field, before the `vrfQuote` block), add:
```tsx
      <div>
        <label className="block text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470] mb-2">
          Invite by email · optional
        </label>
        <textarea
          value={inviteEmails}
          onChange={e => setInviteEmails(e.target.value)}
          placeholder="alice@example.com, bob@example.com"
          rows={2}
          className={`${field} border-[#e6e2d9] resize-none`}
        />
        <p className="text-xs text-[#6b6470] mt-1.5">
          They’ll get an email with a link to join. You can also copy a shareable link after creating.
        </p>
      </div>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Lint the changed file**

Run: `pnpm --filter web lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/CreateWizard.tsx
git commit -m "feat(web): invite-by-email field in CreateWizard"
```

---

### Task 9: Invite/share panel on the circle page

**Files:**
- Create: `apps/web/src/components/InvitePanel.tsx`
- Modify: `apps/web/src/components/CircleView.tsx`

**Context:** Only the creator can mint invites (API enforces it). The panel builds the copyable link from `window.location.origin` so no web env var is needed, minting the token via the API. Show it in FILLING state, to the creator.

- [ ] **Step 1: Write `InvitePanel`**

Create `apps/web/src/components/InvitePanel.tsx`:

```tsx
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

  // Build the link from the current origin so we never depend on a web env var.
  const shareUrl = (token: string) =>
    `${window.location.origin}/circle/${circleAddress}?invite=${token}`;

  async function mint() {
    setBusy(true);
    setMsg(null);
    try {
      const token = await getAccessToken();
      const res = await createInvites(token, circleAddress, parseEmails(emails));
      // API returns an absolute URL built from PUBLIC_WEB_URL; prefer the current
      // origin for the copy button so a dev/preview host shares correctly. Parse
      // the token via URL (robust if the URL ever gains other query params).
      const tok = new URL(res.linkUrl).searchParams.get('invite') ?? '';
      setLinkUrl(shareUrl(tok));
      const sent = res.invited.length;
      if (sent > 0) setMsg(`Sent ${sent} email invite${sent === 1 ? '' : 's'}.`);
    } catch (e: any) {
      setMsg(e?.message?.includes('403') || /creator/i.test(e?.message ?? '')
        ? 'Only the circle creator can send invites.'
        : (e?.message ?? 'Could not create invites.'));
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
```

- [ ] **Step 2: Render it in `CircleView` (FILLING state only)**

In `apps/web/src/components/CircleView.tsx`, add the import:
```typescript
import { InvitePanel } from '@/components/InvitePanel';
```
Then, right after the `{/* Seats */}` `Card` closes (after its `</Card>`), add:
```tsx
      {stateName === 'FILLING' && <InvitePanel circleAddress={circleAddress} />}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/InvitePanel.tsx apps/web/src/components/CircleView.tsx
git commit -m "feat(web): creator invite/share panel on circle page"
```

---

### Task 10: Invite-gated landing — validate token, route, consume on join

**Files:**
- Modify: `apps/web/src/app/circle/[id]/page.tsx`
- Modify: `apps/web/src/components/CircleView.tsx`

**Context:** The circle page is a server component that awaits `params`. We read `searchParams` there too and pass the invite token into `CircleView`. `CircleView` is already wrapped in `AuthGate` (which shows a Privy sign-in gate for a new user), so a new user opening the link is prompted to register, and after auth they're on the same URL → the join UI.

**Important:** `AuthGate` returns its own sign-in screen *before* rendering children when unauthenticated, so any notice placed inside the children subtree is invisible to a not-yet-registered invitee — exactly the person the invite notice is for. So we pass **invite-aware `title`/`blurb` into `AuthGate`** (the new-user sees "You've been invited… sign in to join" on the sign-in screen itself), AND render the notice inside the children for the already-authenticated case. We also call `consumeInvite` once the user becomes a member.

- [ ] **Step 1: Pass the invite token from the page**

Replace `apps/web/src/app/circle/[id]/page.tsx` with:
```tsx
import { CircleView } from '@/components/CircleView';

export default async function CirclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { id } = await params;
  const { invite } = await searchParams;
  return <CircleView circleAddress={id as `0x${string}`} inviteToken={invite} />;
}
```

- [ ] **Step 2: Accept `inviteToken` in `CircleView` and validate it**

In `CircleViewProps`, add:
```typescript
interface CircleViewProps {
  circleAddress: `0x${string}`;
  inviteToken?: string;
}
```
Update the signature:
```typescript
export function CircleView({ circleAddress, inviteToken }: CircleViewProps) {
```
Add imports:
```typescript
import { usePrivy } from '@privy-io/react-auth';
import { validateInvite, consumeInvite, type ValidateResult } from '@/lib/invites';
```
Add state + Privy token accessor near the other hooks:
```typescript
  const { getAccessToken } = usePrivy();
  const [inviteState, setInviteState] = useState<ValidateResult | null>(null);
  const [consumed, setConsumed] = useState(false);
```
Add an effect to validate the token on mount (only when present):
```typescript
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    validateInvite(inviteToken).then(r => { if (!cancelled) setInviteState(r); });
    return () => { cancelled = true; };
  }, [inviteToken]);
```

- [ ] **Step 3: Consume the token once the user is a member**

`isMember` is computed after `load()` runs. Add an effect that fires consume once, when the invited user has joined:
```typescript
  useEffect(() => {
    if (!inviteToken || consumed) return;
    const joined = members.some(m => m.toLowerCase() === userAddress?.toLowerCase());
    if (!joined) return;
    setConsumed(true);
    getAccessToken().then(t => consumeInvite(t, inviteToken));
  }, [inviteToken, consumed, members, userAddress, getAccessToken]);
```

- [ ] **Step 4: Make the AuthGate invite-aware (so a new user sees the invite on the sign-in screen)**

Find the existing `AuthGate` opening tag in the returned JSX:
```tsx
    <AuthGate title="Sign in to join this circle" blurb="You'll need a wallet to join, commit, and claim. Signing in creates one for you.">
```
Replace it with invite-aware copy derived from `inviteState`:
```tsx
    <AuthGate
      title={inviteState?.valid ? 'You’re invited — sign in to join' : 'Sign in to join this circle'}
      blurb={
        inviteState?.valid
          ? 'Someone invited you to this savings circle. Sign in (we create your wallet) and you’ll land right on the join step.'
          : "You'll need a wallet to join, commit, and claim. Signing in creates one for you."
      }
    >
```

- [ ] **Step 5: Show the invite notice inside the layout (authenticated case)**

Just inside the returned layout, right after the opening `<div className="max-w-3xl ...">` (before the header block), add a notice:
```tsx
      {inviteState && !inviteState.valid && (
        <div className="text-sm text-[#9a4a3a] bg-[#f3e3e0] border border-[#e8cfc9] rounded-sm px-4 py-3">
          {inviteState.reason === 'full'
            ? 'This circle is now full — the invite link is no longer active.'
            : 'This invite link is no longer valid, but you can still view the circle below.'}
        </div>
      )}
      {inviteState?.valid && (
        <div className="text-sm text-[#3a6d4a] bg-[#e6efe8] border border-[#cfe0d3] rounded-sm px-4 py-3">
          You’ve been invited to this circle. Join below to claim your seat.
        </div>
      )}
```

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/circle/\[id\]/page.tsx apps/web/src/components/CircleView.tsx
git commit -m "feat(web): invite-gated circle landing (validate + consume on join)"
```

---

## Chunk 4: Verification

### Task 11: End-to-end verification on Monad testnet

**Files:** none (manual verification, matching how the repo verifies flows today)

- [ ] **Step 1: Start the stack**

Run: `pnpm dev` (or the repo's documented dev command for api + web + indexer).
Expected: web on :3000, api on :4000, indexer running.

- [ ] **Step 2: Create + invite flow**

- Sign in, open the dashboard (confirm listed circles is the first screen).
- Create a 2-seat circle with one email in the "Invite by email" field.
- Confirm: auto-navigation to `/circle/<addr>`; the InvitePanel shows; "Create invite link" yields a copyable link; the API console shows the fallback invite email (or a real email arrives if `RESEND_API_KEY` is set).
- Confirm the new circle appears on the dashboard list.

- [ ] **Step 3: Existing-user link join**

- Copy the link, open it in a second already-authenticated session.
- Confirm the green "invited" notice, join succeeds, and `Invite.status` flips to CONSUMED (check via `prisma studio` or the API).

- [ ] **Step 4: New-user link + capacity gate**

- Open the link in a fresh browser/incognito (no session).
- Confirm the AuthGate sign-in prompt shows (register step); after Privy sign-in you land on the join UI on the same URL; join succeeds.
- Now the 2-seat circle is full: re-open the link and confirm `GET /api/invites/:token` returns `valid:false, reason:'full'` and the UI shows "This circle is now full".

- [ ] **Step 5: Full regression**

Run: `pnpm --filter @bhishi/api test && pnpm --filter web exec tsc --noEmit && pnpm --filter @bhishi/api build`
Expected: all green.

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "chore: verification fixups for circle invitations"
```

---

## Notes / deviations to record during execution

- If `pnpm dev` isn't the real dev command, use the one in the repo README and note it here.
- If the workspace filter names differ from `@bhishi/api` / `web` / `@bhishi/db`, correct the commands (check each `package.json` `name`) and note it.
- If a dev Postgres isn't reachable, `prisma migrate dev` will fail — fall back to `prisma generate` and ensure the migration is applied in the deploy environment before shipping.
