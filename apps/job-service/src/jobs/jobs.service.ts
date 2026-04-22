import { Injectable } from '@nestjs/common';

@Injectable()
export class JobsService {
  create(data: unknown) {
    return { message: 'create job', data };
  }

  findAll() {
    return { message: 'find all jobs' };
  }

  findOne(id: string) {
    return { message: 'find job', id };
  }

  remove(id: string) {
    return { message: 'remove job', id };
  }
}
