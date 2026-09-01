import { JwtPayload } from '@jqs/common';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
