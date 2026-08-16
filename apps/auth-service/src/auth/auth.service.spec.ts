import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  };
  let jwt: { sign: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    };
    jwt = { sign: vi.fn() };
    service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);
  });

  describe('register', () => {
    it('creates a new user when the email is not taken', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: '1', email: 'a@b.de', passwordHash: 'hashed' });

      const result = await service.register({ email: 'a@b.de', password: 'password123' });

      expect(result).toEqual({ id: '1', email: 'a@b.de' });
      expect(prisma.user.create).toHaveBeenCalledOnce();
    });

    it('throws ConflictException when the email is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: '1', email: 'a@b.de' });

      await expect(
        service.register({ email: 'a@b.de', password: 'password123' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns an access token for valid credentials', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({ id: '1', email: 'a@b.de', passwordHash });
      jwt.sign.mockReturnValue('signed-token');

      const result = await service.login({ email: 'a@b.de', password: 'password123' });

      expect(result).toEqual({ accessToken: 'signed-token' });
      expect(jwt.sign).toHaveBeenCalledWith({ sub: '1', email: 'a@b.de' });
    });

    it('throws UnauthorizedException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'a@b.de', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when the password is wrong', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      prisma.user.findUnique.mockResolvedValue({ id: '1', email: 'a@b.de', passwordHash });

      await expect(
        service.login({ email: 'a@b.de', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
