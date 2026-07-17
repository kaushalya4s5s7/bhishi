import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * Fields a user may edit on their own profile. Identity fields (walletAddress,
 * privyUserId, email) are set from the verified session, never the body.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'avatarUrl must be a valid URL' })
  @MaxLength(500)
  avatarUrl?: string;
}
