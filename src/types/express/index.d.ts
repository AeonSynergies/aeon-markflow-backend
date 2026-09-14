import type { OrgAccessSummary } from '../../services/orgAccess.service';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
      };
      orgAccess?: OrgAccessSummary;
    }
  }
}

export {};
