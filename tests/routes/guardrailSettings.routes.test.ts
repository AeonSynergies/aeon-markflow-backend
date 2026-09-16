import type { Request, Response } from 'express';

jest.mock('../../src/services/guardrailSettings.service', () => ({
  GUARDRAIL_SETTINGS_DEFAULTS: jest.requireActual('../../src/services/guardrailSettings.service')
    .GUARDRAIL_SETTINGS_DEFAULTS,
  deleteGuardrailSettings: jest.fn(),
  getGuardrailSettingsView: jest.fn(),
  listGuardrailSettingsViewsForOrg: jest.fn(),
  upsertGuardrailSettings: jest.fn(),
}));
jest.mock('../../src/models/Organization.model', () => ({ Organization: { findById: jest.fn() } }));

import { Organization } from '../../src/models/Organization.model';
import {
  GUARDRAIL_SETTINGS_DEFAULTS,
  deleteGuardrailSettings,
  getGuardrailSettingsView,
  listGuardrailSettingsViewsForOrg,
  upsertGuardrailSettings,
} from '../../src/services/guardrailSettings.service';
import {
  deleteGuardrailSettingsHandler,
  getGuardrailSettingsHandler,
  listGuardrailSettingsHandler,
  upsertGuardrailSettingsHandler,
} from '../../src/routes/guardrailSettings.routes';

function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

const SAMPLE_VIEW = {
  orgId: 'org-1',
  domain: 'mail.aeonsynergies.com',
  settings: GUARDRAIL_SETTINGS_DEFAULTS,
  hasOverride: false,
  overriddenFields: [],
};

describe('guardrailSettings.routes handlers', () => {
  afterEach(() => jest.clearAllMocks());

  describe('listGuardrailSettingsHandler', () => {
    it('resolves views for every domain in the org\'s sending_domains', async () => {
      (Organization.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          sending_domains: [{ domain: 'mail.aeonsynergies.com' }, { domain: 'aeonsynergies.com' }],
        }),
      });
      (listGuardrailSettingsViewsForOrg as jest.Mock).mockResolvedValue([SAMPLE_VIEW]);

      const req = { params: { orgId: 'org-1' } } as unknown as Request;
      const res = mockRes();

      await listGuardrailSettingsHandler(req, res, jest.fn());

      expect(listGuardrailSettingsViewsForOrg).toHaveBeenCalledWith('org-1', [
        'mail.aeonsynergies.com',
        'aeonsynergies.com',
      ]);
      expect(res.json).toHaveBeenCalledWith([
        expect.objectContaining({ domain: 'mail.aeonsynergies.com', has_override: false }),
      ]);
    });

    it('resolves an empty domain list when the org has none configured', async () => {
      (Organization.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      (listGuardrailSettingsViewsForOrg as jest.Mock).mockResolvedValue([]);

      const req = { params: { orgId: 'org-1' } } as unknown as Request;
      await listGuardrailSettingsHandler(req, mockRes(), jest.fn());

      expect(listGuardrailSettingsViewsForOrg).toHaveBeenCalledWith('org-1', []);
    });
  });

  describe('getGuardrailSettingsHandler', () => {
    it('returns the resolved view for one domain', async () => {
      (getGuardrailSettingsView as jest.Mock).mockResolvedValue(SAMPLE_VIEW);
      const req = { params: { orgId: 'org-1', domain: 'mail.aeonsynergies.com' } } as unknown as Request;
      const res = mockRes();

      await getGuardrailSettingsHandler(req, res, jest.fn());

      expect(getGuardrailSettingsView).toHaveBeenCalledWith('org-1', 'mail.aeonsynergies.com');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          ramp_up_starting_daily_cap: GUARDRAIL_SETTINGS_DEFAULTS.rampUpStartingDailyCap,
          has_override: false,
          overridden_fields: [],
        }),
      );
    });
  });

  describe('upsertGuardrailSettingsHandler', () => {
    it('upserts the override for one domain', async () => {
      (upsertGuardrailSettings as jest.Mock).mockResolvedValue({
        ...SAMPLE_VIEW,
        settings: { ...GUARDRAIL_SETTINGS_DEFAULTS, rampUpStartingDailyCap: 50 },
        hasOverride: true,
        overriddenFields: ['rampUpStartingDailyCap'],
      });
      const req = {
        params: { orgId: 'org-1', domain: 'mail.aeonsynergies.com' },
        body: { ramp_up_starting_daily_cap: 50 },
      } as unknown as Request;
      const res = mockRes();

      await upsertGuardrailSettingsHandler(req, res, jest.fn());

      expect(upsertGuardrailSettings).toHaveBeenCalledWith('org-1', 'mail.aeonsynergies.com', {
        ramp_up_starting_daily_cap: 50,
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ ramp_up_starting_daily_cap: 50, has_override: true }),
      );
    });
  });

  describe('deleteGuardrailSettingsHandler', () => {
    it('deletes the override and returns 204', async () => {
      const req = { params: { orgId: 'org-1', domain: 'mail.aeonsynergies.com' } } as unknown as Request;
      const res = mockRes();

      await deleteGuardrailSettingsHandler(req, res, jest.fn());

      expect(deleteGuardrailSettings).toHaveBeenCalledWith('org-1', 'mail.aeonsynergies.com');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });
  });
});
