import { Module } from '@nestjs/common';
import { SponsorController } from './sponsor.controller.js';
import { SponsorService } from './sponsor.service.js';

@Module({
  controllers: [SponsorController],
  providers: [SponsorService],
  exports: [SponsorService],
})
export class SponsorModule {}
