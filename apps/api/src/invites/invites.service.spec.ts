import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { InvitesService } from './invites.service';

describe('InvitesService', () => {
  const circleFindUnique = jest.fn();
  const memberCount = jest.fn();
  const inviteFindUnique = jest.fn();
  const inviteUpsert = jest.fn();
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
              findUnique: inviteFindUnique,
              upsert: inviteUpsert,
              update: inviteUpdate,
            },
          },
        },
      ],
    }).compile();
    return moduleRef.get(InvitesService);
  }

  beforeEach(() => {
    [circleFindUnique, memberCount, inviteFindUnique, inviteUpsert, inviteUpdate, sendCircleInvite]
      .forEach(m => m.mockReset());
    circleFindUnique.mockResolvedValue({ address: '0xcircle', creator: '0xcreator', seats: 2, state: 'FILLING' });
    memberCount.mockResolvedValue(0);
    inviteUpsert.mockImplementation(({ create }: any) => Promise.resolve({ ...create }));
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
      '0xCreator',
    );
    const kinds = inviteUpsert.mock.calls.map((c: any) => c[0].create.kind);
    expect(kinds.filter((k: string) => k === 'LINK')).toHaveLength(1);
    expect(kinds.filter((k: string) => k === 'EMAIL')).toHaveLength(2);
    expect(sendCircleInvite).toHaveBeenCalledTimes(2);
    expect(res.linkUrl).toContain('/circle/0xcircle?invite=');
    expect(res.invited).toHaveLength(2);

    // Each upsert is keyed on the unique constraint (circleAddress, kind, email).
    const linkCall = inviteUpsert.mock.calls.find((c: any) => c[0].create.kind === 'LINK')[0];
    expect(linkCall.where).toEqual({
      circleAddress_kind_email: { circleAddress: '0xcircle', kind: 'LINK', email: '' },
    });
    const emailCall = inviteUpsert.mock.calls.find((c: any) => c[0].create.email === 'a@b.com')[0];
    expect(emailCall.where).toEqual({
      circleAddress_kind_email: { circleAddress: '0xcircle', kind: 'EMAIL', email: 'a@b.com' },
    });
  });

  it('reuses an existing LINK instead of minting a second one', async () => {
    inviteUpsert.mockImplementation(({ where }: any) =>
      where.circleAddress_kind_email.kind === 'LINK'
        ? Promise.resolve({ token: 'existing', kind: 'LINK' })
        : Promise.resolve({ token: 'new-email-token' }),
    );
    const svc = await make();
    const res = await svc.createInvites({ circleAddress: '0xCircle' }, '0xcreator');
    expect(inviteUpsert).toHaveBeenCalledTimes(1);
    const call = inviteUpsert.mock.calls[0][0];
    expect(call.where).toEqual({
      circleAddress_kind_email: { circleAddress: '0xcircle', kind: 'LINK', email: '' },
    });
    expect(call.update).toEqual({});
    expect(res.linkUrl).toContain('invite=existing');
  });

  it('dedupes duplicate emails within a single call before upserting', async () => {
    const svc = await make();
    const res = await svc.createInvites(
      { circleAddress: '0xCircle', emails: ['a@b.com', 'A@B.com', ' a@b.com '] },
      '0xcreator',
    );
    const emailUpserts = inviteUpsert.mock.calls.filter((c: any) => c[0].create.kind === 'EMAIL');
    expect(emailUpserts).toHaveLength(1);
    expect(sendCircleInvite).toHaveBeenCalledTimes(1);
    expect(res.invited).toHaveLength(1);
  });

  it('validate() returns full=reason when the circle has no open seats', async () => {
    memberCount.mockResolvedValue(2);
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
