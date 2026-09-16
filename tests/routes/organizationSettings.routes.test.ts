import type { Request, Response } from 'express';

jest.mock('../../src/services/organizationSettings.service', () => ({
  getOrganizationSettings: jest.fn(),
  updateOrganizationSettings: jest.fn(),
}));

import {
  getOrganizationSettings,
  updateOrganizationSettings,
} from '../../src/services/organizationSettings.service';
import {
  getOrganizationSettingsHandler,
  updateOrganizationSettingsHandler,
} from '../../src/routes/organizationSettings.routes';

function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('organizationSettings.routes handlers', () => {
  afterEach(() => jest.clearAllMocks());

  describe('getOrganizationSettingsHandler', () => {
    it('returns the org settings for the org param', async () => {
      (getOrganizationSettings as jest.Mock).mockResolvedValue({ _id: 'org-1', name: 'Aeon Miles' });
      const req = { params: { orgId: 'org-1' } } as unknown as Request;
      const res = mockRes();

      await getOrganizationSettingsHandler(req, res, jest.fn());

      expect(getOrganizationSettings).toHaveBeenCalledWith('org-1');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ name: 'Aeon Miles' }));
    });

    it('forwards a service error to next', async () => {
      const error = new Error('boom');
      (getOrganizationSettings as jest.Mock).mockRejectedValue(error);
      const req = { params: { orgId: 'org-1' } } as unknown as Request;
      const res = mockRes();
      const next = jest.fn();

      await getOrganizationSettingsHandler(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('updateOrganizationSettingsHandler', () => {
    it('updates the org settings for the org param', async () => {
      (updateOrganizationSettings as jest.Mock).mockResolvedValue({ _id: 'org-1', send_time_strategy: 'ai_suggested' });
      const req = {
        params: { orgId: 'org-1' },
        body: { send_time_strategy: 'ai_suggested' },
      } as unknown as Request;
      const res = mockRes();

      await updateOrganizationSettingsHandler(req, res, jest.fn());

      expect(updateOrganizationSettings).toHaveBeenCalledWith('org-1', { send_time_strategy: 'ai_suggested' });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ send_time_strategy: 'ai_suggested' }));
    });

    it('forwards a validation error to next', async () => {
      const error = Object.assign(new Error('bad'), { name: 'ValidationError' });
      (updateOrganizationSettings as jest.Mock).mockRejectedValue(error);
      const req = { params: { orgId: 'org-1' }, body: { sending_domains: [{ domain: 'x', purpose: 'bogus' }] } } as unknown as Request;
      const res = mockRes();
      const next = jest.fn();

      await updateOrganizationSettingsHandler(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
