import { Module } from '@nestjs/common';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, JobsModule],
})
export class AppModule {}
