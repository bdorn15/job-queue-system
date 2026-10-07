import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    name: z.string().min(1),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
  });

  it('returns the parsed (and defaulted) value when validation passes', () => {
    const pipe = new ZodValidationPipe(schema);

    const result = pipe.transform({ name: 'send-email' });

    expect(result).toEqual({ name: 'send-email', priority: 'NORMAL' });
  });

  it('throws BadRequestException with the flattened field errors when validation fails', () => {
    const pipe = new ZodValidationPipe(schema);

    expect(() => pipe.transform({ name: '' })).toThrow(BadRequestException);

    try {
      pipe.transform({ name: '' });
      expect.unreachable('transform should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as Record<string, string[]>;
      expect(response).toHaveProperty('name');
      expect(response.name[0]).toMatch(/at least 1/i);
    }
  });

  it('rejects a value of the wrong shape entirely', () => {
    const pipe = new ZodValidationPipe(schema);

    expect(() => pipe.transform('not-an-object')).toThrow(BadRequestException);
  });
});
