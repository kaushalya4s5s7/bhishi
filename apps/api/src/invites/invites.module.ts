import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { InvitesController } from './invites.controller.js';
import { InvitesService } from './invites.service.js';

@Module({
  imports: [EmailModule],
  controllers: [InvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
