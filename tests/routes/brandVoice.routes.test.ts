import type { Request, Response } from 'express';

jest.mock('../../src/services/brandVoice.service', () => ({
  getBrandVoiceGuidelines: jest.fn(),
  updateBrandVoiceGuidelines: jest.fn(),
}));

import { getBrandVoiceGuidelines, updateBrandVoiceGuidelines } from '../../src/services/brandVoice.service';
import { getBrandVoiceGuidelinesHandler, updateBrandVoiceGuidelinesHandler } from '../../src/routes/brandVoice.routes';

function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('brandVoice.routes handlers', () => {
  afterEach(() => jest.clearAllMocks());

  describe('getBrandVoiceGuidelinesHandler', () => {
    it('returns the current guidelines', async () => {
      (getBrandVoiceGuidelines as jest.Mock).mockResolvedValue({ text: 'Be consultative.', version: 'abc123def456' });
      const req = {} as unknown as Request;
      const res = mockRes();

      await getBrandVoiceGuidelinesHandler(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith({ text: 'Be consultative.', version: 'abc123def456' });
    });

    it('forwards a service error to next', async () => {
      const error = new Error('boom');
      (getBrandVoiceGuidelines as jest.Mock).mockRejectedValue(error);
      const next = jest.fn();

      await getBrandVoiceGuidelinesHandler({} as unknown as Request, mockRes(), next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('updateBrandVoiceGuidelinesHandler', () => {
    it('updates the guidelines using the authenticated user as updated_by', async () => {
      (updateBrandVoiceGuidelines as jest.Mock).mockResolvedValue({ text: 'New voice.', version: 'newhash12345' });
      const req = {
        body: { text: 'New voice.' },
        user: { id: 'user-1', email: 'admin@aeonsynergies.com' },
      } as unknown as Request;
      const res = mockRes();

      await updateBrandVoiceGuidelinesHandler(req, res, jest.fn());

      expect(updateBrandVoiceGuidelines).toHaveBeenCalledWith('New voice.', 'user-1');
      expect(res.json).toHaveBeenCalledWith({ text: 'New voice.', version: 'newhash12345' });
    });
  });
});
