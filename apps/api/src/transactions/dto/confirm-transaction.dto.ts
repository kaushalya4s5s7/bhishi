import { IsIn, IsNotEmpty, Matches } from 'class-validator';

const SUPPORTED_ACTIONS = ['join', 'commit', 'reveal', 'createCircle'] as const;
export type ConfirmableAction = (typeof SUPPORTED_ACTIONS)[number];

/**
 * Only a tx hash + which action the client believes it performed. Nothing
 * else the client sends is trusted — the server re-derives everything else
 * (success, logs, args) directly from the chain. See TransactionsService.
 */
export class ConfirmTransactionDto {
  @Matches(/^0x[a-fA-F0-9]{64}$/, { message: 'txHash must be a 32-byte hex string' })
  @IsNotEmpty()
  txHash!: `0x${string}`;

  @IsIn(SUPPORTED_ACTIONS)
  action!: ConfirmableAction;
}
