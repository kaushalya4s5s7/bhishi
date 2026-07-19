import { Module } from '@nestjs/common';
import { CirclesController } from './circles.controller.js';
import { CirclesService } from './circles.service.js';

@Module({
  controllers: [CirclesController],
  providers: [CirclesService],
  exports: [CirclesService],
})
export class CirclesModule {}
