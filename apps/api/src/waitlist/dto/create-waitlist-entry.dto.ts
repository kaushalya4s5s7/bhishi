import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Mirrors the early-access form payload. Note `circleSize` arrives as a string
 * from the HTML form, so it's coerced to Int here (empty string -> undefined).
 */
export class CreateWaitlistEntryDto {
  @IsEmail({}, { message: 'A valid email is required' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  whatsapp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tradition?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : value;
  })
  @IsInt()
  @Min(2)
  circleSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  trackingMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  role?: string;

  @IsOptional()
  @IsBoolean()
  wantsTryNow?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  location?: string;

  /** "What do you feel about our platform?" — shown on the landing page's
   *  community carousel alongside name/tradition/location when present. */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  message?: string;
}
