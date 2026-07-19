import { IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

/**
 * Fields a user may edit on their own profile. Identity fields (walletAddress,
 * privyUserId, email) are set from the verified session, never the body.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;

  // An empty string clears the avatar (fall back to a generated one); only a
  // non-empty value is validated as a URL, so blank submissions don't 400.
  @IsOptional()
  @ValidateIf((_o, v) => v !== '')
  @IsUrl({ require_protocol: true }, { message: 'avatarUrl must be a valid URL' })
  @MaxLength(500)
  avatarUrl?: string;
}
