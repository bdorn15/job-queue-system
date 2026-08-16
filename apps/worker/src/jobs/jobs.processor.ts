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
    // bullmq@4 increments attemptsMade in moveToActive before process() runs,
    // so it's already the 1-indexed current attempt number here (1 on the
    // first run). bullmq@5 changed this to increment only on failure
    // (0-indexed on the first run) — if this package is ever upgraded to v5,
    // these need to go back to `job.attemptsMade + 1`. bullmq is pinned
    // exactly in package.json to avoid drifting across that boundary silently.
    const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);

    const dbJob = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!dbJob) {
      this.logger.warn(`Job ${jobId} no longer exists in DB (deleted after queuing) — skipping`);
      return;
    }

    this.logger.log(`Processing job ${jobId} (attempt ${job.attemptsMade}/${job.opts.attempts ?? 1})`);

    await this.prisma.job.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: job.attemptsMade },
    });

    await this.prisma.jobLog.create({
      data: { jobId, level: 'info', message: `Attempt ${job.attemptsMade} started` },
    });

    try {
      await this.execute(dbJob);

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

  private async execute(dbJob: { name: string; payload: unknown }): Promise<void> {
    this.logger.log(
      `Executing job "${dbJob.name}" with payload: ${JSON.stringify(dbJob.payload)}`,
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
