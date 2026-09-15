import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

/**
 * Where the mailbox poller (src/services/mailboxPoller.service.ts) left off for a given
 * mailbox, so each poll only fetches messages received since the last one — not a re-scan of
 * the whole inbox every cycle.
 */
const mailboxPollCursorSchema = new Schema(
  {
    mailbox: { type: String, required: true, trim: true, unique: true },
    domain: { type: String, required: true, trim: true },
    last_polled_at: { type: Date, required: true },
  },
  { timestamps: true },
);

export type MailboxPollCursorDocument = InferSchemaType<typeof mailboxPollCursorSchema> & { _id: Types.ObjectId };

export const MailboxPollCursor = model('MailboxPollCursor', mailboxPollCursorSchema);
