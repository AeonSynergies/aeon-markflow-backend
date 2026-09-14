import { Types } from 'mongoose';
import { UserAccessGrant } from '../../src/models/UserAccessGrant.model';
import { buildOrgFilter, canAccessOrg, getOrgAccessForUser } from '../../src/services/orgAccess.service';

jest.mock('../../src/models/UserAccessGrant.model', () => ({
  UserAccessGrant: { find: jest.fn() },
}));

function mockGrants(grants: Array<Record<string, unknown>>) {
  (UserAccessGrant.find as jest.Mock).mockReturnValue({
    lean: jest.fn().mockResolvedValue(grants),
  });
}

describe('orgAccess.service', () => {
  const userId = new Types.ObjectId().toString();
  const orgA = new Types.ObjectId().toString();
  const orgB = new Types.ObjectId().toString();

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns no access when the user has no grants', async () => {
    mockGrants([]);
    const access = await getOrgAccessForUser(userId, 'markflow');
    expect(access).toEqual({ allOrgs: false, orgIds: [], roles: [] });
  });

  it('collects org ids and roles from BD-Sales style single-org grants', async () => {
    mockGrants([
      { org_id: orgA, role: 'BD_SALES' },
      { org_id: orgB, role: 'BD_MANAGER' },
    ]);
    const access = await getOrgAccessForUser(userId, 'markflow');
    expect(access.allOrgs).toBe(false);
    expect(access.orgIds.sort()).toEqual([orgA, orgB].sort());
    expect(access.roles.sort()).toEqual(['BD_MANAGER', 'BD_SALES'].sort());
  });

  it('treats a null org_id grant as access to all orgs, ignoring narrower grants', async () => {
    mockGrants([{ org_id: null, role: 'ADMIN' }, { org_id: orgA, role: 'BD_SALES' }]);
    const access = await getOrgAccessForUser(userId, 'markflow');
    expect(access.allOrgs).toBe(true);
    expect(access.orgIds).toEqual([]);
  });

  it('returns no access for a malformed user id rather than querying the database', async () => {
    const access = await getOrgAccessForUser('not-an-object-id', 'markflow');
    expect(access).toEqual({ allOrgs: false, orgIds: [], roles: [] });
    expect(UserAccessGrant.find).not.toHaveBeenCalled();
  });

  describe('canAccessOrg', () => {
    it('allows any org when allOrgs is true', () => {
      expect(canAccessOrg({ allOrgs: true, orgIds: [], roles: [] }, orgA)).toBe(true);
    });

    it('allows only granted orgs otherwise', () => {
      const access = { allOrgs: false, orgIds: [orgA], roles: [] };
      expect(canAccessOrg(access, orgA)).toBe(true);
      expect(canAccessOrg(access, orgB)).toBe(false);
    });
  });

  describe('buildOrgFilter', () => {
    it('returns an empty filter for allOrgs access with no explicit org requested', () => {
      expect(buildOrgFilter({ allOrgs: true, orgIds: [], roles: [] })).toEqual({});
    });

    it('scopes to the caller\'s org ids when no explicit org is requested', () => {
      const access = { allOrgs: false, orgIds: [orgA, orgB], roles: [] };
      expect(buildOrgFilter(access)).toEqual({ org_id: { $in: [orgA, orgB] } });
    });

    it('returns null when the explicit org id is outside the caller\'s access', () => {
      const access = { allOrgs: false, orgIds: [orgA], roles: [] };
      expect(buildOrgFilter(access, orgB)).toBeNull();
    });

    it('scopes to the explicit org id when it is within access', () => {
      const access = { allOrgs: false, orgIds: [orgA], roles: [] };
      expect(buildOrgFilter(access, orgA)).toEqual({ org_id: orgA });
    });
  });
});
