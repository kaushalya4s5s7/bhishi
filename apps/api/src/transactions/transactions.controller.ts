import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrivyAuthGuard, AuthedRequest } from '../auth/privy-auth.guard';
import { TransactionsService } from './transactions.service';
import { ConfirmTransactionDto } from './dto/confirm-transaction.dto';

@Controller('transactions')
@UseGuards(PrivyAuthGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  /**
   * Verified fast-path for the caller's OWN just-confirmed transaction — see
   * TransactionsService for the full rationale. Rate-limited tighter than the
   * baseline since each call does its own getTransactionReceipt RPC round-trip.
   */
  @Post('confirm')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  confirm(@Body() dto: ConfirmTransactionDto, @Req() req: AuthedRequest) {
    const callerAddress = req.user?.walletAddress;
    if (!callerAddress) {
      throw new BadRequestException('No wallet linked to this account yet');
    }
    return this.transactions.confirm(dto.txHash, dto.action, callerAddress);
  }
}
