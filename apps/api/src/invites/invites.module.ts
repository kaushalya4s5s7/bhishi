import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  imports: [EmailModule],
  controllers: [InvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
