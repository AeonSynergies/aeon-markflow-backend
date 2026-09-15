import type { Request, Response } from 'express';
import { Types } from 'mongoose';

jest.mock('../../src/models/TrackedLink.model', () => ({
  TrackedLink: { findById: jest.fn() },
}));
jest.mock('../../src/services/linkTracking.service', () => ({
  recordClick: jest.fn(),
}));

import { TrackedLink } from '../../src/models/TrackedLink.model';
import { handleTrackingRedirect } from '../../src/routes/tracking.routes';
import { recordClick } from '../../src/services/linkTracking.service';

function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('handleTrackingRedirect', () => {
  afterEach(() => jest.clearAllMocks());

  it('404s on a malformed token without querying the database', async () => {
    const req = { params: { token: 'not-an-id' } } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    await handleTrackingRedirect(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(TrackedLink.findById).not.toHaveBeenCalled();
  });

  it('404s when no tracked link matches the token', async () => {
    const id = new Types.ObjectId().toString();
    (TrackedLink.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = { params: { token: id } } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    await handleTrackingRedirect(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('records the click and redirects to the destination url', async () => {
    const id = new Types.ObjectId().toString();
    (TrackedLink.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ destination_url: 'https://example.com/book' }),
    });
    (recordClick as jest.Mock).mockResolvedValueOnce(undefined);

    const req = {
      params: { token: id },
      ip: '1.2.3.4',
      get: jest.fn().mockReturnValue('jest-agent'),
    } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    await handleTrackingRedirect(req, res, next);

    expect(recordClick).toHaveBeenCalledWith(id, { ip: '1.2.3.4', userAgent: 'jest-agent' });
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://example.com/book');
  });

  it('still redirects when click logging fails', async () => {
    const id = new Types.ObjectId().toString();
    (TrackedLink.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ destination_url: 'https://example.com/book' }),
    });
    (recordClick as jest.Mock).mockRejectedValueOnce(new Error('db down'));

    const req = { params: { token: id }, ip: '1.2.3.4', get: jest.fn() } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    await handleTrackingRedirect(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(302, 'https://example.com/book');
    expect(next).not.toHaveBeenCalled();
  });

  it('passes lookup errors to next', async () => {
    const id = new Types.ObjectId().toString();
    const error = new Error('mongo down');
    (TrackedLink.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockRejectedValue(error) });

    const req = { params: { token: id } } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    await handleTrackingRedirect(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
