import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { JobsService } from './jobs.service';
import type { PrismaService } from '@jqs/database';
import type { Queue } from 'bullmq';

describe('JobsService', () => {
  let service: JobsService;
  let prisma: {
    job: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };
  let jobQueue: { add: ReturnType<typeof vi.fn>; getJob: ReturnType<typeof vi.fn> };

  const userId = 'user-1';

  beforeEach(() => {
    prisma = {
      job: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn(),
      },
    };
    jobQueue = { add: vi.fn(), getJob: vi.fn() };
    service = new JobsService(prisma as unknown as PrismaService, jobQueue as unknown as Queue);
  });

  describe('create', () => {
    it('creates the Postgres row and enqueues it under the same jobId', async () => {
      const runAt = new Date(Date.now() + 60_000);
      const dbJob = {
        id: 'job-1',
        name: 'send-email',
        payload: { to: 'a@b.de' },
        priority: 'HIGH',
        runAt,
        maxAttempts: 5,
        userId,
      };
      prisma.job.create.mockResolvedValue(dbJob);

      const result = await service.create(
        { name: 'send-email', payload: { to: 'a@b.de' }, priority: 'HIGH', runAt, maxAttempts: 5 },
        userId,
      );

      expect(prisma.job.create).toHaveBeenCalledWith({
        data: { name: 'send-email', payload: { to: 'a@b.de' }, priority: 'HIGH', runAt, maxAttempts: 5, userId },
      });
      expect(jobQueue.add).toHaveBeenCalledWith(
        'send-email',
        { jobId: 'job-1' },
        expect.objectContaining({
          jobId: 'job-1',
          priority: 1,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
        }),
      );
      expect(result).toBe(dbJob);
    });

    it.each([
      ['HIGH', 1],
      ['NORMAL', 2],
      ['LOW', 3],
    ] as const)('maps priority %s to BullMQ priority %d', async (priority, bullPriority) => {
      const dbJob = { id: 'job-1', name: 'x', runAt: new Date(), maxAttempts: 3, userId };
      prisma.job.create.mockResolvedValue(dbJob);

      await service.create({ name: 'x', payload: {}, priority, runAt: new Date(), maxAttempts: 3 }, userId);

      expect(jobQueue.add).toHaveBeenCalledWith(
        'x',
        { jobId: 'job-1' },
        expect.objectContaining({ priority: bullPriority }),
      );
    });

    it('clamps the delay to 0 for a runAt in the past', async () => {
      const pastRunAt = new Date(Date.now() - 60_000);
      const dbJob = { id: 'job-1', name: 'x', runAt: pastRunAt, maxAttempts: 3, userId };
      prisma.job.create.mockResolvedValue(dbJob);

      await service.create({ name: 'x', payload: {}, priority: 'NORMAL', runAt: pastRunAt, maxAttempts: 3 }, userId);

      expect(jobQueue.add).toHaveBeenCalledWith('x', { jobId: 'job-1' }, expect.objectContaining({ delay: 0 }));
    });
  });

  describe('findAll', () => {
    it('scopes the query to the given user, newest first', () => {
      service.findAll(userId);

      expect(prisma.job.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('returns the job with its logs when it belongs to the user', async () => {
      const dbJob = { id: 'job-1', userId, logs: [] };
      prisma.job.findUnique.mockResolvedValue(dbJob);

      const result = await service.findOne('job-1', userId);

      expect(prisma.job.findUnique).toHaveBeenCalledWith({ where: { id: 'job-1' }, include: { logs: true } });
      expect(result).toBe(dbJob);
    });

    it('throws NotFoundException when the job does not exist', async () => {
      prisma.job.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing', userId)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the job belongs to a different user', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1', userId: 'someone-else' });

      await expect(service.findOne('job-1', userId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the job does not exist', async () => {
      prisma.job.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', userId)).rejects.toThrow(NotFoundException);
      expect(jobQueue.getJob).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the job belongs to a different user', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1', userId: 'someone-else' });

      await expect(service.remove('job-1', userId)).rejects.toThrow(NotFoundException);
    });

    it('deletes the Postgres row directly when nothing is queued under that id', async () => {
      const dbJob = { id: 'job-1', userId };
      prisma.job.findUnique.mockResolvedValue(dbJob);
      jobQueue.getJob.mockResolvedValue(undefined);
      prisma.job.delete.mockResolvedValue(dbJob);

      const result = await service.remove('job-1', userId);

      expect(prisma.job.delete).toHaveBeenCalledWith({ where: { id: 'job-1' } });
      expect(result).toBe(dbJob);
    });

    it('removes the queued BullMQ job before deleting the Postgres row', async () => {
      const dbJob = { id: 'job-1', userId };
      prisma.job.findUnique.mockResolvedValue(dbJob);
      const remove = vi.fn().mockResolvedValue(undefined);
      jobQueue.getJob.mockResolvedValue({ remove });
      prisma.job.delete.mockResolvedValue(dbJob);

      await service.remove('job-1', userId);

      expect(remove).toHaveBeenCalledOnce();
      expect(prisma.job.delete).toHaveBeenCalledWith({ where: { id: 'job-1' } });
    });

    it('throws ConflictException and keeps the Postgres row when the job is currently running', async () => {
      const dbJob = { id: 'job-1', userId };
      prisma.job.findUnique.mockResolvedValue(dbJob);
      const remove = vi.fn().mockRejectedValue(new Error('locked'));
      jobQueue.getJob.mockResolvedValue({ remove });

      await expect(service.remove('job-1', userId)).rejects.toThrow(ConflictException);
      expect(prisma.job.delete).not.toHaveBeenCalled();
    });
  });
});
