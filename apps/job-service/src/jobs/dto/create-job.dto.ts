import { z } from 'zod';

export const CreateJobSchema = z.object({
  name: z.string().min(1),
  payload: z.record(z.unknown()),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
  runAt: z.coerce.date().default(() => new Date()),
  maxAttempts: z.number().int().min(1).max(10).default(3),
});

export type CreateJobDto = z.infer<typeof CreateJobSchema>;
