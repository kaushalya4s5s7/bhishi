import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { CirclesService } from './circles.service.js';
import { IsEthAddressPipe } from '../common/is-eth-address.pipe.js';

/**
 * Indexed read API — serves from Postgres instead of making every browser
 * re-scan the chain with getLogs. On-chain remains the source of truth; the
 * frontend still reads the contract directly for live tx-status UX.
 */
@Controller('circles')
export class CirclesController {
  constructor(private readonly circles: CirclesService) {}

  @Get()
  list(
    @Query('member') member?: string,
    @Query('mine') mine?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.circles.list({
      member,
      mine,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get(':address')
  detail(@Param('address', IsEthAddressPipe) address: string) {
    return this.circles.detail(address);
  }

  @Get(':address/events')
  events(@Param('address', IsEthAddressPipe) address: string, @Query('take') take?: string) {
    // Parsed manually rather than via ParseIntPipe: with the global
    // ValidationPipe in play, an omitted ?take= reaches the pipe as '' and is
    // rejected as "numeric string is expected" instead of defaulting.
    const parsed = take !== undefined && take !== '' ? Number(take) : undefined;
    if (parsed !== undefined && !Number.isFinite(parsed)) {
      throw new BadRequestException('take must be a number');
    }
    return this.circles.events(address, parsed);
  }
}
