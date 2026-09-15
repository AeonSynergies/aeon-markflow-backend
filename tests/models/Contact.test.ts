import { Contact } from '../../src/models/Contact.model';

describe('Contact model', () => {
  it('defaults global_do_not_contact to false', () => {
    const doc = new Contact({ email: 'lead@example.com' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.global_do_not_contact).toBe(false);
  });

  it('rejects a malformed email', () => {
    const doc = new Contact({ email: 'not-an-email' });
    const err = doc.validateSync();
    expect(err?.errors.email).toBeDefined();
  });

  it('lowercases and trims email', () => {
    const doc = new Contact({ email: '  Lead@Example.com  ' });
    expect(doc.email).toBe('lead@example.com');
  });

  it('accepts firmographics with multiple stations', () => {
    const doc = new Contact({
      phone: '+15550001234',
      firmographics: { dsp_code: 'DXX1', drivers: 40, vans: 25, stations: ['DXX1', 'DXX2'] },
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.firmographics?.stations).toEqual(['DXX1', 'DXX2']);
  });

  it('does not require email or phone (a Contact can start with either)', () => {
    const doc = new Contact({ phone: '+15550001234' });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('defaults timezone to null and accepts an IANA zone string', () => {
    const withDefault = new Contact({ email: 'lead@example.com' });
    expect(withDefault.timezone).toBeNull();

    const withTimezone = new Contact({ email: 'lead@example.com', timezone: 'America/New_York' });
    expect(withTimezone.validateSync()).toBeUndefined();
    expect(withTimezone.timezone).toBe('America/New_York');
  });
});
