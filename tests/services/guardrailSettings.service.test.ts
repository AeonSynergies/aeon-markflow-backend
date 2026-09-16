jest.mock('../../src/models/GuardrailSettings.model', () => ({
  GuardrailSettings: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
}));

import { GuardrailSettings } from '../../src/models/GuardrailSettings.model';
import {
  GUARDRAIL_SETTINGS_DEFAULTS,
  deleteGuardrailSettings,
  getGuardrailSettingsView,
  listGuardrailSettingsViewsForOrg,
  resolveGuardrailSettings,
  upsertGuardrailSettings,
} from '../../src/services/guardrailSettings.service';

function lean(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

describe('guardrailSettings.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('resolveGuardrailSettings', () => {
    it('resolves to exactly the hardcoded defaults when there is no override', async () => {
      (GuardrailSettings.findOne as jest.Mock).mockReturnValue(lean(null));
      await expect(resolveGuardrailSettings('org-1', 'x.com')).resolves.toEqual(GUARDRAIL_SETTINGS_DEFAULTS);
    });

    it('merges a partial override over the defaults, field by field', async () => {
      (GuardrailSettings.findOne as jest.Mock).mockReturnValue(
        lean({ ramp_up_starting_daily_cap: 50, hard_stop_bounce_rate: 0.02 }),
      );
      const resolved = await resolveGuardrailSettings('org-1', 'x.com');
      expect(resolved).toEqual({
        ...GUARDRAIL_SETTINGS_DEFAULTS,
        rampUpStartingDailyCap: 50,
        hardStopBounceRate: 0.02,
      });
    });

    it('treats a stored null the same as unset — falls back to the default', async () => {
      (GuardrailSettings.findOne as jest.Mock).mockReturnValue(lean({ ramp_up_starting_daily_cap: null }));
      const resolved = await resolveGuardrailSettings('org-1', 'x.com');
      expect(resolved.rampUpStartingDailyCap).toBe(GUARDRAIL_SETTINGS_DEFAULTS.rampUpStartingDailyCap);
    });
  });

  describe('getGuardrailSettingsView', () => {
    it('reports no override and every field as default when none exists', async () => {
      (GuardrailSettings.findOne as jest.Mock).mockReturnValue(lean(null));
      const view = await getGuardrailSettingsView('org-1', 'x.com');
      expect(view).toEqual({
        orgId: 'org-1',
        domain: 'x.com',
        settings: GUARDRAIL_SETTINGS_DEFAULTS,
        hasOverride: false,
        overriddenFields: [],
      });
    });

    it('lists exactly which fields are overridden', async () => {
      (GuardrailSettings.findOne as jest.Mock).mockReturnValue(
        lean({ ramp_up_starting_daily_cap: 50, throttle_bounce_rate: 0.01 }),
      );
      const view = await getGuardrailSettingsView('org-1', 'x.com');
      expect(view.hasOverride).toBe(true);
      expect(view.overriddenFields.sort()).toEqual(['rampUpStartingDailyCap', 'throttleBounceRate'].sort());
      expect(view.settings.rampUpStartingDailyCap).toBe(50);
      expect(view.settings.throttleBounceRate).toBe(0.01);
    });
  });

  describe('listGuardrailSettingsViewsForOrg', () => {
    it('resolves a view per domain given', async () => {
      (GuardrailSettings.findOne as jest.Mock).mockReturnValue(lean(null));
      const views = await listGuardrailSettingsViewsForOrg('org-1', ['a.com', 'b.com']);
      expect(views).toHaveLength(2);
      expect(views.map((v) => v.domain)).toEqual(['a.com', 'b.com']);
    });
  });

  describe('upsertGuardrailSettings', () => {
    it('upserts only the fields provided and returns the resolved view', async () => {
      (GuardrailSettings.findOneAndUpdate as jest.Mock).mockResolvedValue({});
      (GuardrailSettings.findOne as jest.Mock).mockReturnValue(lean({ ramp_up_starting_daily_cap: 50 }));

      const view = await upsertGuardrailSettings('org-1', 'x.com', { ramp_up_starting_daily_cap: 50 });

      expect(GuardrailSettings.findOneAndUpdate).toHaveBeenCalledWith(
        { org_id: 'org-1', domain: 'x.com' },
        { $set: { org_id: 'org-1', domain: 'x.com', ramp_up_starting_daily_cap: 50 } },
        { upsert: true },
      );
      expect(view.settings.rampUpStartingDailyCap).toBe(50);
    });

    it('omits undefined fields from the $set rather than writing them as null', async () => {
      (GuardrailSettings.findOneAndUpdate as jest.Mock).mockResolvedValue({});
      (GuardrailSettings.findOne as jest.Mock).mockReturnValue(lean(null));

      await upsertGuardrailSettings('org-1', 'x.com', {
        ramp_up_starting_daily_cap: 50,
        hard_stop_bounce_rate: undefined,
      });

      expect(GuardrailSettings.findOneAndUpdate).toHaveBeenCalledWith(
        { org_id: 'org-1', domain: 'x.com' },
        { $set: { org_id: 'org-1', domain: 'x.com', ramp_up_starting_daily_cap: 50 } },
        { upsert: true },
      );
    });
  });

  describe('deleteGuardrailSettings', () => {
    it('deletes the override document for this (org, domain) pair', async () => {
      await deleteGuardrailSettings('org-1', 'x.com');
      expect(GuardrailSettings.deleteOne).toHaveBeenCalledWith({ org_id: 'org-1', domain: 'x.com' });
    });
  });
});
