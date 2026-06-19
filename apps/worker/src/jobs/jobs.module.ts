import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsProcessor } from './jobs.processor';
import { JOB_QUEUE } from './jobs.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: JOB_QUEUE }),
  ],
  providers: [JobsProcessor],
})
export class JobsModule {}
