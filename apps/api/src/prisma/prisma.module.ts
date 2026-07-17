import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global so feature modules don't each re-import it (arch-module-sharing). */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
