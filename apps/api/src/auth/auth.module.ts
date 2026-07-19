import { Global, Module } from '@nestjs/common';
import { PrivyService } from './privy.service.js';
import { OptionalPrivyAuthGuard, PrivyAuthGuard } from './privy-auth.guard.js';

@Global()
@Module({
  providers: [PrivyService, PrivyAuthGuard, OptionalPrivyAuthGuard],
  exports: [PrivyService, PrivyAuthGuard, OptionalPrivyAuthGuard],
})
export class AuthModule {}
