import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { TrackedLink } from '../models/TrackedLink.model';
import { recordOpen } from '../services/emailEngagement.service';
import { recordClick } from '../services/linkTracking.service';

// The smallest valid transparent GIF — served for every open-pixel hit regardless of outcome,
// so a slow/failed recording never shows a broken image or delays the client's own rendering.
const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7', 'base64');

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
      await recordClick(link, { ip: req.ip, userAgent: req.get('user-agent') ?? undefined });
    } catch {
      // Never let a click-logging failure block the redirect itself.
    }

    res.redirect(302, link.destination_url);
  } catch (error) {
    next(error);
  }
}

/**
 * The open-tracking pixel. Always returns the same 1x1 GIF regardless of whether the token is
 * valid or recording succeeds — an open pixel has no "destination" to fail out of the way a
 * click redirect does, so there's nothing to 404 or error toward.
 */
export async function handleOpenPixel(req: Request, res: Response): Promise<void> {
  const token = req.params.token;
  if (typeof token === 'string' && Types.ObjectId.isValid(token)) {
    try {
      await recordOpen(token);
    } catch {
      // Best-effort — see TRANSPARENT_GIF's comment.
    }
  }

  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store');
  res.end(TRANSPARENT_GIF);
}

export const trackingRouter = Router();
trackingRouter.get('/r/:token', handleTrackingRedirect);
trackingRouter.get('/o/:token', handleOpenPixel);
