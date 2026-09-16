jest.mock('../../src/models/Organization.model', () => ({ Organization: { findById: jest.fn() } }));

import { Organization } from '../../src/models/Organization.model';
import { OrganizationNotFoundError } from '../../src/services/enrollment.service';
import { getOrganizationSettings, updateOrganizationSettings } from '../../src/services/organizationSettings.service';

describe('organizationSettings.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('getOrganizationSettings', () => {
    it('returns the org when found', async () => {
      const org = { _id: 'org-1', name: 'Aeon Miles' };
      (Organization.findById as jest.Mock).mockResolvedValue(org);
      await expect(getOrganizationSettings('org-1')).resolves.toBe(org);
    });

    it('throws OrganizationNotFoundError when missing', async () => {
      (Organization.findById as jest.Mock).mockResolvedValue(null);
      await expect(getOrganizationSettings('missing')).rejects.toThrow(OrganizationNotFoundError);
    });
  });

  describe('updateOrganizationSettings', () => {
    function orgDoc() {
      return {
        _id: 'org-1',
        set: jest.fn(),
        send_time_strategy: 'manual',
        save: jest.fn().mockResolvedValue(undefined),
      };
    }

    it('sets only the fields given, full-replacing arrays via .set()', async () => {
      const org = orgDoc();
      (Organization.findById as jest.Mock).mockResolvedValue(org);

      await updateOrganizationSettings('org-1', {
        enabled_features: ['ai_reply_classification'],
        sending_domains: [{ domain: 'mail.aeonmiles.com', purpose: 'marketing', mailboxes: [] }],
      });

      expect(org.set).toHaveBeenCalledWith('enabled_features', ['ai_reply_classification']);
      expect(org.set).toHaveBeenCalledWith('sending_domains', [
        { domain: 'mail.aeonmiles.com', purpose: 'marketing', mailboxes: [] },
      ]);
      expect(org.send_time_strategy).toBe('manual');
      expect(org.save).toHaveBeenCalled();
    });

    it('updates send_time_strategy directly, not via .set()', async () => {
      const org = orgDoc();
      (Organization.findById as jest.Mock).mockResolvedValue(org);

      await updateOrganizationSettings('org-1', { send_time_strategy: 'ai_suggested' });

      expect(org.send_time_strategy).toBe('ai_suggested');
      expect(org.set).not.toHaveBeenCalled();
    });

    it('leaves fields untouched when omitted', async () => {
      const org = orgDoc();
      (Organization.findById as jest.Mock).mockResolvedValue(org);

      await updateOrganizationSettings('org-1', {});

      expect(org.set).not.toHaveBeenCalled();
      expect(org.send_time_strategy).toBe('manual');
      expect(org.save).toHaveBeenCalled();
    });

    it('throws OrganizationNotFoundError when missing', async () => {
      (Organization.findById as jest.Mock).mockResolvedValue(null);
      await expect(updateOrganizationSettings('missing', {})).rejects.toThrow(OrganizationNotFoundError);
    });
  });
});
