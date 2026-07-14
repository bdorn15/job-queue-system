import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateJobSchema, CreateJobDto } from './dto/create-job.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@ApiTags('Jobs')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new job and add it to the queue' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'payload'],
      properties: {
        name: { type: 'string', example: 'send-email' },
        payload: { type: 'object', example: { to: 'user@example.com', subject: 'Hello' } },
        priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH'], default: 'NORMAL' },
        runAt: { type: 'string', format: 'date-time', description: 'Schedule for later execution' },
        maxAttempts: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Job created and queued' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@Body(new ZodValidationPipe(CreateJobSchema)) body: CreateJobDto, @CurrentUser() user: JwtPayload) {
    return this.jobsService.create(body, user.sub);
  }

  @Get()
  @ApiOperation({ summary: 'List all jobs for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Array of jobs' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.jobsService.findAll(user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single job with its logs' })
  @ApiResponse({ status: 200, description: 'Job with logs' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.jobsService.findOne(id, user.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a job' })
  @ApiResponse({ status: 200, description: 'Job deleted' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.jobsService.remove(id, user.sub);
  }
}
