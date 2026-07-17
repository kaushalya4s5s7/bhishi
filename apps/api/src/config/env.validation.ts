import { plainToInstance, Type } from 'class-transformer';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsInt, validateSync } from 'class-validator';

export enum NodeEnv {
  development = 'development',
  production = 'production',
  test = 'test',
}

/**
 * Fail-fast env validation: the process refuses to boot on missing/invalid
 * config rather than throwing confusing runtime errors on the first request.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.development;

  // Env vars are always strings; coerce before the Int check.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PORT = 4000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  /** Privy app id/secret — required to verify user JWTs on protected routes. */
  @IsString()
  @IsOptional()
  PRIVY_APP_ID?: string;

  @IsString()
  @IsOptional()
  PRIVY_APP_SECRET?: string;

  /** Comma-separated allowed CORS origins. */
  @IsString()
  @IsOptional()
  CORS_ORIGINS?: string;

  /** Relayer wallet that sponsors circle-creation funding (native MON top-ups).
   *  Optional: if unset, the sponsor endpoint is disabled and the app falls back
   *  to the user funding their own wallet. */
  @IsString()
  @IsOptional()
  RELAYER_PRIVATE_KEY?: string;

  /** Monad RPC the relayer sends through. Defaults to the public testnet RPC. */
  @IsString()
  @IsOptional()
  MONAD_RPC_URL?: string;

  /** Max sponsorship top-ups per user per rolling 24h. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  SPONSOR_DAILY_CAP = 3;

  /** Resend API key for sending invite emails. If unset, the EmailService logs
   *  the email to the console instead of sending (local-dev friendly). */
  @IsString()
  @IsOptional()
  RESEND_API_KEY?: string;

  /** From-address for invite emails. Defaults to Resend's shared onboarding
   *  sender so it works before a domain is verified. */
  @IsString()
  @IsOptional()
  EMAIL_FROM?: string;

  /** Public origin of the web app, used to build invite links in emails.
   *  Defaults to localhost for dev. */
  @IsString()
  @IsOptional()
  PUBLIC_WEB_URL?: string;

  @IsOptional()
  @IsIn(['trace', 'debug', 'info', 'warn', 'error'])
  LOG_LEVEL = 'info';
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`);
  }
  return validated;
}
