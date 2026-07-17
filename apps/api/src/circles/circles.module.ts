import { Module } from '@nestjs/common';
import { CirclesController } from './circles.controller';
import { CirclesService } from './circles.service';

@Module({
  controllers: [CirclesController],
  providers: [CirclesService],
  exports: [CirclesService],
})
export class CirclesModule {}
