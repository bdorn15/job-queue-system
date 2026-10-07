import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { JwtService } from '@nestjs/jwt';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwt: { verify: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    jwt = { verify: vi.fn() };
    guard = new JwtAuthGuard(jwt as unknown as JwtService);
  });

  it('allows the request and attaches the payload when the token is valid', () => {
    const payload = { sub: 'user-1', email: 'a@b.de' };
    jwt.verify.mockReturnValue(payload);
    const request: any = { headers: { authorization: 'Bearer good-token' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.user).toBe(payload);
    expect(jwt.verify).toHaveBeenCalledWith('good-token', expect.objectContaining({ secret: expect.any(String) }));
  });

  it('throws UnauthorizedException when there is no Authorization header', () => {
    const request: any = { headers: {} };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the header does not start with "Bearer "', () => {
    const request: any = { headers: { authorization: 'Basic abc123' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when jwt.verify rejects the token', () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    const request: any = { headers: { authorization: 'Bearer bad-token' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
