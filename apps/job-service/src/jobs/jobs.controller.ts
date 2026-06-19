import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateJobSchema, CreateJobDto } from './dto/create-job.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateJobSchema)) body: CreateJobDto, @CurrentUser() user: JwtPayload) {
    return this.jobsService.create(body, user.sub);
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.jobsService.findAll(user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.jobsService.findOne(id, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.jobsService.remove(id, user.sub);
  }
}
