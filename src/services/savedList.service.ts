import { Types } from 'mongoose';
import { Lead } from '../models/Lead.model';
import { SavedList, type SavedListDocument } from '../models/SavedList.model';
import { SavedListNotFoundError } from './enrollment.service';

export interface SavedListSummary {
  savedListId: string;
  orgId: string;
  name: string;
  leadCount: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toSavedListSummary(savedList: {
  _id: { toString(): string };
  org_id: { toString(): string };
  name: string;
  lead_ids: unknown[];
  created_by?: { toString(): string } | null;
  createdAt: Date;
  updatedAt: Date;
}): SavedListSummary {
  return {
    savedListId: savedList._id.toString(),
    orgId: savedList.org_id.toString(),
    name: savedList.name,
    leadCount: savedList.lead_ids.length,
    createdBy: savedList.created_by ? savedList.created_by.toString() : null,
    createdAt: savedList.createdAt,
    updatedAt: savedList.updatedAt,
  };
}

/** Ids among `leadIds` that are actually Leads belonging to `orgId` — a lead id for a Lead
 * in a different org (or that doesn't exist at all) is silently excluded from the list rather
 * than trusted, since SavedList membership is meant to be org-scoped just like Lead itself. */
async function resolveOrgLeadIds(orgId: string, leadIds: string[]): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();
  const leads = await Lead.find({ _id: { $in: leadIds }, org_id: orgId }, '_id').lean();
  return new Set(leads.map((lead) => lead._id.toString()));
}

/**
 * Creates a new SavedList for an org, optionally seeded with a bulk selection of lead ids (the
 * Leads screen's "enroll selected leads into a SavedList" action, new-list path). Any lead id
 * that doesn't resolve to a Lead in this org is dropped rather than trusted blindly.
 */
export async function createSavedList(
  orgId: string,
  name: string,
  leadIds: string[] = [],
  createdBy?: string,
): Promise<{ savedList: SavedListDocument; addedCount: number; skippedCount: number }> {
  const orgLeadIds = await resolveOrgLeadIds(orgId, leadIds);
  const savedList = await SavedList.create({
    org_id: orgId,
    name,
    lead_ids: Array.from(orgLeadIds),
    created_by: createdBy ?? null,
  });
  return { savedList, addedCount: orgLeadIds.size, skippedCount: leadIds.length - orgLeadIds.size };
}

export async function listSavedListsForOrg(orgId: string): Promise<SavedListSummary[]> {
  const savedLists = await SavedList.find({ org_id: orgId }).sort({ createdAt: -1 }).lean();
  return savedLists.map(toSavedListSummary);
}

export async function getSavedList(savedListId: string) {
  const savedList = await SavedList.findById(savedListId);
  if (!savedList) throw new SavedListNotFoundError(savedListId);
  return savedList;
}

/**
 * Appends a bulk selection of lead ids to an existing SavedList (the "enroll selected leads
 * into a SavedList" action, add-to-existing path) — deduped against the list's current
 * membership and against lead ids that don't belong to the list's own org.
 */
export async function addLeadsToSavedList(
  savedListId: string,
  leadIds: string[],
): Promise<{ savedList: SavedListDocument; addedCount: number; skippedCount: number }> {
  const savedList = await getSavedList(savedListId);
  const orgLeadIds = await resolveOrgLeadIds(savedList.org_id.toString(), leadIds);

  const existing = new Set(savedList.lead_ids.map((id) => id.toString()));
  const toAdd = Array.from(orgLeadIds).filter((id) => !existing.has(id));

  savedList.lead_ids.push(...toAdd.map((id) => new Types.ObjectId(id)));
  await savedList.save();

  return { savedList, addedCount: toAdd.length, skippedCount: leadIds.length - toAdd.length };
}

export { SavedListNotFoundError };
