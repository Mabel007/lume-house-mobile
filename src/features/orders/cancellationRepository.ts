import type { SupabaseClient } from '@supabase/supabase-js';
import { parseCancellation, maximumReasonLength, type CancellationRequest } from './cancellation';
import { requireOwner } from './orderRepository';

// A cancellation request is the shop's record, reached through the same two security definer functions the
// website uses. This app never sets an order status, never touches stock, and never speaks of a refund.
const readFailure = 'Your cancellation request could not be loaded. Check your connection and retry.';
const sendFailure = 'The cancellation request could not be confirmed. Reload to review it before retrying.';

// The functions name their own refusals and nothing else, so those names are the only provider text this
// screen can repeat. Anything unrecognised becomes a safe line: a raised detail never reaches the customer.
const refusals: Record<string, string> = {
  AUTH_REQUIRED: 'Please sign in again to review your cancellation request.',
  INVALID_REASON: 'This cancellation reason cannot be sent. Please shorten it and retry.',
  ORDER_UNAVAILABLE: 'This order is not on your account, so its cancellation request is not shown.',
  REQUEST_ALREADY_EXISTS: 'A cancellation request is already recorded for this order. Reload to review it before retrying.',
  CANCELLATION_REQUEST_UNAVAILABLE: 'This order has moved on, so a cancellation request is no longer possible.',
};

function failure(detail: unknown, fallback: string) {
  const message = typeof (detail as { message?: unknown } | null)?.message === 'string' ? (detail as { message: string }).message : '';
  const refusal = Object.keys(refusals).find(name => message.includes(name));
  return refusal ? refusals[refusal] : fallback;
}

// null is the shop's answer for "no request yet". There is no customer withdraw path in this contract, so an
// absent request is shown as absent and nothing about the order is inferred from it.
export async function getCancellation(client: SupabaseClient, userId: string, orderId: string, active: () => boolean): Promise<CancellationRequest | null> {
  await requireOwner(client, userId, active);
  const { data, error } = await client.rpc('customer_get_cancellation_request', { p_order_id: orderId });
  if (error) throw new Error(failure(error, readFailure));
  const record = parseCancellation(data);
  // A request belonging to another order id is not this customer's answer, even if it came back for them.
  if (record && record.order_id !== orderId) throw new Error(readFailure);
  return record;
}

// The function is idempotent for one reason on one order: the same text returns the stored record instead of
// a second request, so a retry after a lost response is safe as long as the reason has not changed.
export async function requestCancellation(client: SupabaseClient, userId: string, orderId: string, reason: string, active: () => boolean): Promise<CancellationRequest> {
  await requireOwner(client, userId, active);
  const trimmed = reason.trim();
  if (trimmed.length > maximumReasonLength) throw new Error(refusals.INVALID_REASON);
  const { data, error } = await client.rpc('customer_cancellation_request', { p_order_id: orderId, p_reason: trimmed });
  if (error) throw new Error(failure(error, sendFailure));
  const record = parseCancellation(data);
  // An answer about another order, or with different reason text, is not confirmation of this request.
  if (!record || record.order_id !== orderId || record.reason !== trimmed) throw new Error(sendFailure);
  return record;
}
