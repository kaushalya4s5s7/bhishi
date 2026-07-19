import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/env.validation.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { WaitlistModule } from './waitlist/waitlist.module.js';
import { CirclesModule } from './circles/circles.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { SponsorModule } from './sponsor/sponsor.module.js';
import { InvitesModule } from './invites/invites.module.js';
import { TransactionsModule } from './transactions/transactions.module.js';
import { PushModule } from './push/push.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Baseline rate limit across the API (security-rate-limiting); routes can
    // tighten it with @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    HealthModule,
    WaitlistModule,
    CirclesModule,
    ProfilesModule,
    SponsorModule,
    InvitesModule,
    TransactionsModule,
    PushModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
