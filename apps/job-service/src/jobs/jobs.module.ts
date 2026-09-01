import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JOB_QUEUE } from '@jqs/common';

@Module({
  imports: [
    BullModule.registerQueue({ name: JOB_QUEUE }),
  ],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
