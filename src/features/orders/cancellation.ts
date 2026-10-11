// The customer's view of one table the shop owns: a request for cancellation, never a cancellation itself.
// Every field is the shape the security definer functions return, and nothing here is inferred around a gap.

export const cancellationStatuses = ['pending', 'accepted', 'rejected', 'closed'] as const;
export type CancellationStatus = typeof cancellationStatuses[number];

export const maximumReasonLength = 500;

export type CancellationRequest = {
  order_id: string;
  reason: string;
  requested_at: string;
  resolved_at: string | null;
  status: CancellationStatus;
  resolution: string | null;
};

const unreadable = () => new Error('The cancellation request could not be read. Please retry.');

function text(value: unknown, maximum: number) {
  if (typeof value !== 'string' || value.length > maximum) throw unreadable();
  return value;
}
function moment(value: unknown) {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw unreadable();
  return value;
}

// null is the answer for "this order has no cancellation request", so it is the only value allowed to be
// absent. Anything else is a contract break, and a half-read request is refused instead of displayed.
export function parseCancellation(value: unknown): CancellationRequest | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unreadable();
  const row = value as Record<string, unknown>;
  const order_id = text(row.order_id, 64);
  if (!order_id.trim()) throw unreadable();
  const reason = text(row.reason, maximumReasonLength);
  const requested_at = moment(row.requested_at);
  if (!(cancellationStatuses as readonly string[]).includes(String(row.status))) throw unreadable();
  const status = row.status as CancellationStatus;
  const resolution = row.resolution;
  if (resolution !== null && typeof resolution !== 'string') throw unreadable();
  const resolved_at = row.resolved_at === undefined || row.resolved_at === null ? null : moment(row.resolved_at);
  // The stored record carries one check across these columns; a response that breaks it is not a request
  // this app would describe, because a decision without a date or a date without a decision is a lie.
  if (status === 'pending' && (resolved_at !== null || resolution !== null)) throw unreadable();
  if (status !== 'pending' && (resolved_at === null || resolution === null)) throw unreadable();
  return { order_id, reason, requested_at, resolved_at, status, resolution };
}
