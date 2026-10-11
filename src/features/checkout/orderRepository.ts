import type { SupabaseClient } from '@supabase/supabase-js';
import type { CheckoutPayload } from './checkout';
import { emailStatus, orderStatuses, paymentStatuses, type ExpectedLine, type OrderStatus, type PaymentStatus, type PlacedOrder, type Placement } from './order';
import { shop } from '../../config/shop';

// Every message is the customer-facing form of a rejection the order service actually returns.
const messages: Record<string, string> = {
  AUTH_REQUIRED: 'Please sign in again to place your order.',
  INVALID_REQUEST: 'This order could not be started. Review your Bag and try again.',
  INVALID_CHECKOUT: 'Some checkout details are not accepted yet. Please review them and try again.',
  INVALID_DELIVERY_ZONE: 'Choose a supported Freetown delivery zone, then review your totals.',
  INVALID_DELIVERY_DETAILS: 'Check the delivery address. Delivery is currently limited to Freetown.',
  PRODUCT_UNAVAILABLE: 'A selection in your Bag is no longer available. Refresh your Bag before ordering.',
  OUT_OF_STOCK: 'A selection in your Bag is out of stock. Refresh your Bag before ordering.',
  CART_LIMIT: 'Your Bag holds more than one order can take. Remove a selection and try again.',
  CART_CHANGED: 'Your Bag changed while you were checking out. Review the new Bag before ordering.',
  EMPTY_CART: 'Your Bag is empty. Add a selection before ordering.',
  ORDER_TOTAL_LIMIT: 'This order is larger than the shop can take online. Please contact the shop.',
  REQUEST_TOO_LARGE: 'This order is too large to send. Remove a selection from your Bag and try again.',
  REQUEST_REFUSED: 'The order service refused this request. Your Bag and saved details are unchanged.',
  UNCONFIRMED: 'We could not confirm your order. Retry the same request, or check your orders before trying again.',
  ORDER_UNAVAILABLE: 'We could not confirm your order. Retry the same request, or check your orders before trying again.',
  CHECKOUT_UNCONFIRMED: 'We could not check your previous checkout. Retry with the same request, or check your orders first.',
  INVALID_RESPONSE: 'The order response could not be read. Check your orders before trying again.',
};
const refused = new Set(Object.keys(messages));

export class OrderError extends Error {
  constructor(public readonly code: string, public readonly definite = true) {
    super(messages[code] ?? 'Your order could not be confirmed. Please check your orders before trying again.');
  }
}

const orderIdentifier = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePlacedOrder(value: unknown): PlacedOrder {
  const invalid = () => new OrderError('INVALID_RESPONSE', false);
  if (!value || typeof value !== 'object') throw invalid();
  const row = value as Record<string, unknown>;
  const text = (key: string, maximum: number) => {
    const field = row[key];
    if (typeof field !== 'string' || !field || field.length > maximum) throw invalid();
    return field;
  };
  const id = text('id', 64);
  const reference = text('reference', 40);
  if (!/^LH-[A-F0-9]{16}$/.test(reference)) throw invalid();
  const total = row.total;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) throw invalid();
  const currency = text('currency', 8);
  if (currency !== shop.currency) throw invalid();
  const status = text('status', 40);
  if (!(orderStatuses as readonly string[]).includes(status)) throw invalid();
  const paymentStatus = text('payment_status', 40);
  if (!(paymentStatuses as readonly string[]).includes(paymentStatus)) throw invalid();
  return { id, reference, total, currency, status: status as OrderStatus, paymentStatus: paymentStatus as PaymentStatus };
}

// A response that arrived but cannot be read is uncertain: the order may already exist server-side.
export function parsePlacement(value: unknown): Placement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OrderError('INVALID_RESPONSE', false);
  const row = value as Record<string, unknown>;
  return { order: parsePlacedOrder(row.order), emailStatus: emailStatus(row.email_status) };
}

type Refusal = { status?: number; json?: () => Promise<unknown> };

// The function's own status and stable error token are the only inputs: a code it raises before the
// transaction, or a 4xx it cannot have got past, proves nothing was created. 5xx and lost responses do not.
export async function edgeFailure(reason: unknown): Promise<OrderError> {
  const response = reason && typeof reason === 'object' && 'context' in reason ? (reason as { context?: unknown }).context : undefined;
  const refusal = response && typeof response === 'object' ? response as Refusal : undefined;
  const status = typeof refusal?.status === 'number' ? refusal.status : 0;
  let code: string | null = null;
  try {
    const body = await refusal?.json?.();
    if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
      const value = (body as { error: string }).error;
      if (refused.has(value)) code = value;
    }
  } catch { /* A body that is not the structured refusal tells us nothing. */ }
  if (code) return new OrderError(code);
  if (status === 413) return new OrderError('REQUEST_TOO_LARGE');
  if (status >= 400 && status < 500) return new OrderError('REQUEST_REFUSED');
  if (status >= 500) return new OrderError('ORDER_UNAVAILABLE', false);
  return new OrderError('UNCONFIRMED', false);
}

export type PlaceRequest = { requestId: string; checkout: CheckoutPayload; expectedCart: readonly ExpectedLine[] };

// Direct RPC is not used: it commits the order without the function's post-commit email attempt,
// so a mobile order would sit in a different state from a web order of the same cart.
export async function placeOrder(client: SupabaseClient, accessToken: string, request: PlaceRequest): Promise<Placement> {
  const { data, error } = await client.functions.invoke('place-order', {
    body: { request_id: request.requestId, checkout: request.checkout, expected_cart: request.expectedCart, cart_version: 2 },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error) throw await edgeFailure(error);
  return parsePlacement(data);
}

// The owner-scoped read that turns a lost response into a known order: the request id is the only key.
export async function findCheckout(client: SupabaseClient, accessToken: string, requestId: string): Promise<string | null> {
  if (!orderIdentifier.test(requestId)) throw new OrderError('CHECKOUT_UNCONFIRMED', false);
  const { data, error } = await client.from('orders').select('id').eq('checkout_request_id', requestId)
    .maybeSingle().setHeader('Authorization', `Bearer ${accessToken}`);
  if (error) throw new OrderError('CHECKOUT_UNCONFIRMED', false);
  const id = (data as { id?: unknown } | null)?.id;
  if (id === null || id === undefined) return null;
  if (typeof id !== 'string' || !orderIdentifier.test(id)) throw new OrderError('CHECKOUT_UNCONFIRMED', false);
  return id;
}
