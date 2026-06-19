import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_QUEUE } from './jobs.constants';

@Processor(JOB_QUEUE)
export class JobsProcessor extends WorkerHost {
  private readonly logger = new Logger(JobsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ jobId: string }>): Promise<void> {
    const { jobId } = job.data;
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    this.logger.log(`Processing job ${jobId} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`);

    await this.prisma.job.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: job.attemptsMade + 1 },
    });

    await this.prisma.jobLog.create({
      data: { jobId, level: 'info', message: `Attempt ${job.attemptsMade + 1} started` },
    });

    try {
      await this.execute(job);

      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      await this.prisma.jobLog.create({
        data: { jobId, level: 'info', message: 'Job completed successfully' },
      });

      this.logger.log(`Job ${jobId} completed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.prisma.jobLog.create({
        data: { jobId, level: 'error', message: `Attempt failed: ${message}` },
      });

      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: isLastAttempt ? 'FAILED' : 'RETRYING' },
      });

      this.logger.error(`Job ${jobId} failed (isLastAttempt: ${isLastAttempt}): ${message}`);
      throw error;
    }
  }

  private async execute(job: Job<{ jobId: string }>): Promise<void> {
    this.logger.log(`Executing job "${job.name}" with payload: ${JSON.stringify(job.data)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
