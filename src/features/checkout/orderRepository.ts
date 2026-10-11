import type { SupabaseClient } from '@supabase/supabase-js';
import type { CheckoutPayload } from './checkout';
import { orderStatuses, paymentStatuses, type ExpectedLine, type OrderStatus, type PaymentStatus, type PlacedOrder } from './order';
import { shop } from '../../config/shop';

// Every message is the customer-facing form of a rejection the RPC actually raises.
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
  SCHEMA_NOT_READY: 'Ordering is not available yet. Your Bag and details are unchanged.',
};

export class OrderError extends Error {
  constructor(public readonly code: string, public readonly definite = true) {
    super(messages[code] ?? 'Your order could not be confirmed. Please check your orders before trying again.');
  }
}

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

function rpcError(error: { code?: string; message?: string }) {
  if (error.code === 'PGRST202') return new OrderError('SCHEMA_NOT_READY');
  // Only a known rejection proves the order was not created; anything else stays uncertain.
  if (error.code === 'P0001' && error.message && Object.hasOwn(messages, error.message)) return new OrderError(error.message);
  return new OrderError('UNCONFIRMED', false);
}

export type PlaceRequest = { requestId: string; checkout: CheckoutPayload; expectedCart: readonly ExpectedLine[] };

export async function placeOrder(client: SupabaseClient, accessToken: string, request: PlaceRequest): Promise<PlacedOrder> {
  const { data, error } = await client.rpc('place_variant_order', {
    p_request_id: request.requestId, p_checkout: request.checkout, p_expected_cart: request.expectedCart,
  }).setHeader('Authorization', `Bearer ${accessToken}`);
  if (error) throw rpcError(error);
  return parsePlacedOrder(data);
}
