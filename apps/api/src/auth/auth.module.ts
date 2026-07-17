import { Global, Module } from '@nestjs/common';
import { PrivyService } from './privy.service';
import { OptionalPrivyAuthGuard, PrivyAuthGuard } from './privy-auth.guard';

@Global()
@Module({
  providers: [PrivyService, PrivyAuthGuard, OptionalPrivyAuthGuard],
  exports: [PrivyService, PrivyAuthGuard, OptionalPrivyAuthGuard],
})
export class AuthModule {}
