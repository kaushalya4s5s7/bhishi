import { IsString, MaxLength } from 'class-validator';

/**
 * Web Push subscription payload from the browser's PushManager. The wallet
 * identity comes from the verified Privy session, never the body.
 */
export class SaveSubscriptionDto {
  @IsString()
  @MaxLength(1000)
  endpoint!: string;

  @IsString()
  @MaxLength(200)
  p256dh!: string;

  @IsString()
  @MaxLength(200)
  auth!: string;
}
