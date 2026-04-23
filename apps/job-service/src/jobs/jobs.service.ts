import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: unknown) {
    return { message: 'create job', data };
  }

  findAll() {
    return this.prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.job.findUnique({
      where: { id },
      include: { logs: true },
    });
  }

  remove(id: string) {
    return this.prisma.job.delete({
      where: { id },
    });
  }
}
