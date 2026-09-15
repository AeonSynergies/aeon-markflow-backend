import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { TrackedLink } from '../models/TrackedLink.model';
import { recordClick } from '../services/linkTracking.service';

export async function handleTrackingRedirect(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params.token;
    if (typeof token !== 'string' || !Types.ObjectId.isValid(token)) {
      res.status(404).end();
      return;
    }

    const link = await TrackedLink.findById(token).lean();
    if (!link) {
      res.status(404).end();
      return;
    }

    try {
      await recordClick(token, { ip: req.ip, userAgent: req.get('user-agent') ?? undefined });
    } catch {
      // Never let a click-logging failure block the redirect itself.
    }

    res.redirect(302, link.destination_url);
  } catch (error) {
    next(error);
  }
}

export const trackingRouter = Router();
trackingRouter.get('/r/:token', handleTrackingRedirect);
