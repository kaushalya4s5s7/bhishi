import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Token amounts are Decimal in the DB; serialise as strings so a JS client
 *  never silently loses precision on a big value. */
function serialize<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'bigint') out[k] = v.toString();
    else if (v && typeof v === 'object' && 'toFixed' in v && typeof (v as { toFixed: unknown }).toFixed === 'function') {
      out[k] = (v as { toFixed: () => string }).toFixed();
    } else out[k] = v;
  }
  return out;
}

@Injectable()
export class CirclesService {
  constructor(private readonly prisma: PrismaService) {}

  /** List circles, newest first. Optionally filter to those a member is in. */
  async list(params: { member?: string; take?: number; skip?: number }) {
    const take = Math.min(params.take ?? 50, 100);
    const where = params.member
      ? { members: { some: { address: params.member.toLowerCase() } } }
      : {};

    const [rows, total] = await Promise.all([
      this.prisma.circle.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip: params.skip ?? 0,
        include: { _count: { select: { members: true } } },
      }),
      this.prisma.circle.count({ where }),
    ]);

    return {
      total,
      circles: rows.map((r) => ({
        ...serialize(r),
        memberCount: r._count.members,
        _count: undefined,
      })),
    };
  }

  async detail(address: string) {
    const circle = await this.prisma.circle.findUnique({
      where: { address: address.toLowerCase() },
      include: {
        members: { orderBy: { joinedAt: 'asc' } },
        rounds: { orderBy: { roundNumber: 'asc' } },
      },
    });
    if (!circle) throw new NotFoundException(`Circle ${address} not indexed`);

    return {
      ...serialize(circle),
      members: circle.members.map(serialize),
      rounds: circle.rounds.map(serialize),
    };
  }

  async events(address: string, take = 50) {
    const rows = await this.prisma.chainEvent.findMany({
      where: { circleAddress: address.toLowerCase() },
      orderBy: [{ blockNumber: 'desc' }, { logIndex: 'desc' }],
      take: Math.min(take, 200),
    });
    return { events: rows.map(serialize) };
  }
}
