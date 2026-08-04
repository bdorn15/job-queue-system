import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJobDto } from './dto/create-job.dto';
import { JOB_QUEUE } from './jobs.constants';
import { Prisma } from '@jqs/database';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(JOB_QUEUE) private readonly jobQueue: Queue,
  ) {}

  async create(dto: CreateJobDto, userId: string) {
    // NOTE: dual-write risk — if BullMQ fails after the DB insert, the job
    // stays PENDING forever. Acceptable for this project; production would
    // need a compensating delete or an outbox pattern.
    const job = await this.prisma.job.create({
      data: {
        name: dto.name,
        payload: dto.payload as Prisma.InputJsonValue,
        priority: dto.priority,
        runAt: dto.runAt,
        maxAttempts: dto.maxAttempts,
        userId,
      },
    });

    await this.jobQueue.add(job.name, { jobId: job.id }, {
      delay: Math.max(0, job.runAt.getTime() - Date.now()),
      priority: dto.priority === 'HIGH' ? 1 : dto.priority === 'LOW' ? 3 : 2,
      attempts: dto.maxAttempts,
      backoff: { type: 'exponential', delay: 5000 },
    });

    return job;
  }

  findAll(userId: string) {
    return this.prisma.job.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: { logs: true },
    });

    if (!job || job.userId !== userId) {
      throw new NotFoundException(`Job ${id} not found`);
    }

    return job;
  }

  async remove(id: string, userId: string) {
    const job = await this.prisma.job.findUnique({ where: { id } });

    if (!job || job.userId !== userId) {
      throw new NotFoundException(`Job ${id} not found`);
    }

    return this.prisma.job.delete({ where: { id } });
  }
}
