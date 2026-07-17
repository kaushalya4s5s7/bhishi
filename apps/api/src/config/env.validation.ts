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
