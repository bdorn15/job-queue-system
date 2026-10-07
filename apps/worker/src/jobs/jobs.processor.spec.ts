import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { JobsProcessor } from './jobs.processor';
import type { PrismaService } from '@jqs/database';
import type { Job } from 'bullmq';

describe('JobsProcessor', () => {
  let processor: JobsProcessor;
  let prisma: {
    job: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    jobLog: { create: ReturnType<typeof vi.fn> };
  };

  const bullJob = (attemptsMade: number, attempts: number) =>
    ({
      data: { jobId: 'job-1' },
      attemptsMade,
      opts: { attempts },
    }) as unknown as Job<{ jobId: string }>;

  beforeEach(() => {
    prisma = {
      job: { findUnique: vi.fn(), update: vi.fn() },
      jobLog: { create: vi.fn() },
    };
    processor = new JobsProcessor(prisma as unknown as PrismaService);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('process', () => {
    it('skips processing and logs a warning when the DB row no longer exists', async () => {
      prisma.job.findUnique.mockResolvedValue(null);

      await processor.process(bullJob(1, 3));

      expect(prisma.job.update).not.toHaveBeenCalled();
      expect(prisma.jobLog.create).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('job-1'));
    });

    it('marks the job RUNNING then COMPLETED on success', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1', name: 'send-email', payload: { to: 'a@b.de' } });
      vi.spyOn(processor as any, 'execute').mockResolvedValue(undefined);

      await processor.process(bullJob(1, 3));

      expect(prisma.job.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'job-1' },
        data: { status: 'RUNNING', startedAt: expect.any(Date), attempts: 1 },
      });
      expect(prisma.job.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'job-1' },
        data: { status: 'COMPLETED', completedAt: expect.any(Date) },
      });
      expect(prisma.jobLog.create).toHaveBeenNthCalledWith(1, {
        data: { jobId: 'job-1', level: 'info', message: 'Attempt 1 started' },
      });
      expect(prisma.jobLog.create).toHaveBeenNthCalledWith(2, {
        data: { jobId: 'job-1', level: 'info', message: 'Job completed successfully' },
      });
    });

    it('marks the job RETRYING and re-throws when it fails with attempts remaining', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1', name: 'send-email', payload: {} });
      vi.spyOn(processor as any, 'execute').mockRejectedValue(new Error('boom'));

      await expect(processor.process(bullJob(1, 3))).rejects.toThrow('boom');

      expect(prisma.job.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'job-1' },
        data: { status: 'RETRYING' },
      });
      expect(prisma.jobLog.create).toHaveBeenNthCalledWith(2, {
        data: { jobId: 'job-1', level: 'error', message: 'Attempt failed: boom' },
      });
    });

    it('marks the job FAILED and re-throws when it fails on the last attempt', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1', name: 'send-email', payload: {} });
      vi.spyOn(processor as any, 'execute').mockRejectedValue(new Error('boom'));

      await expect(processor.process(bullJob(3, 3))).rejects.toThrow('boom');

      expect(prisma.job.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'job-1' },
        data: { status: 'FAILED' },
      });
    });
  });

  describe('execute', () => {
    it('logs the job name and payload', async () => {
      await (processor as any).execute({ name: 'send-email', payload: { to: 'a@b.de' } });

      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Executing job "send-email" with payload: {"to":"a@b.de"}',
      );
    });
  });
});
