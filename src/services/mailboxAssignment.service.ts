import type { SenderMailboxEntry } from '../constants/organization';
import { DomainSendEvent } from '../models/DomainSendEvent.model';

export class NoActiveMailboxError extends Error {
  constructor(domain: string) {
    super(`No active mailbox is configured for sending domain ${domain}`);
    this.name = 'NoActiveMailboxError';
  }
}

/**
 * Distributes sends across a domain's configured mailboxes round-robin. Rather than an
 * in-memory rotating cursor — which would race and drift across enrollmentProcessor's
 * concurrent BullMQ workers, and reset on every deploy — this counts each `active` mailbox's own
 * all-time DomainSendEvent 'sent' history and picks whichever has sent the fewest. That converges
 * on the same even rotation a cursor would, but makes the choice explicit and visible: it's a
 * read of the same durable, per-mailbox event log SendGuardrail itself aggregates, not hidden
 * state a human can't inspect. A newly added mailbox starts at 0 and so is picked first, exactly
 * as a round robin would seat a new participant at the front of the line.
 *
 * Ties break on the order mailboxes are listed in Organization.sending_domains[].mailboxes.
 * `inactive` mailboxes are never candidates, but keep their own send history for when they're
 * reactivated.
 */
export async function assignMailboxForDomain(domain: string, mailboxes: SenderMailboxEntry[]): Promise<string> {
  const active = mailboxes.filter((mailbox) => mailbox.status === 'active');
  if (active.length === 0) {
    throw new NoActiveMailboxError(domain);
  }
  if (active.length === 1) {
    return active[0].address;
  }

  const rows = await DomainSendEvent.aggregate<{ _id: string; count: number }>([
    { $match: { domain, kind: 'sent', mailbox: { $in: active.map((mailbox) => mailbox.address) } } },
    { $group: { _id: '$mailbox', count: { $sum: 1 } } },
  ]);
  const sendCountByMailbox = new Map(rows.map((row) => [row._id, row.count]));

  return active.reduce((leastLoaded, candidate) => {
    const candidateCount = sendCountByMailbox.get(candidate.address) ?? 0;
    const leastLoadedCount = sendCountByMailbox.get(leastLoaded.address) ?? 0;
    return candidateCount < leastLoadedCount ? candidate : leastLoaded;
  }).address;
}
