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
      '0xCreator',
    );
    const kinds = inviteCreate.mock.calls.map(c => c[0].data.kind);
    expect(kinds.filter(k => k === 'LINK')).toHaveLength(1);
    expect(kinds.filter(k => k === 'EMAIL')).toHaveLength(2);
    expect(sendCircleInvite).toHaveBeenCalledTimes(2);
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
