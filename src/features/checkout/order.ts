import { cartLine, type CartItem } from '../cart/cart';
import type { Product } from '../products/products';

export const orderStatuses = ['placed', 'confirmed', 'processing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'cancelled'] as const;
export const paymentStatuses = ['pending', 'awaiting_payment', 'paid', 'failed'] as const;
export type OrderStatus = typeof orderStatuses[number];
export type PaymentStatus = typeof paymentStatuses[number];

export type PlacedOrder = { id: string; reference: string; total: number; currency: string; status: OrderStatus; paymentStatus: PaymentStatus };
export type Placement = { order: PlacedOrder; emailStatus: EmailStatus };
export type ExpectedLine = { product_id: string; variant_id: string; quantity: number; unit_price: number };

// The only three answers the place-order function can give about a confirmation email.
// 'queued' is the fail-closed answer for "not attempted", "not configured" and "bookkeeping failed",
// so it can never be presented as delivered.
export const emailStates = ['queued', 'sent', 'review_required'] as const;
export type EmailStatus = typeof emailStates[number];

export function emailStatus(value: unknown): EmailStatus {
  return typeof value === 'string' && (emailStates as readonly string[]).includes(value) ? value as EmailStatus : 'queued';
}

// place_variant_order compares p_expected_cart with its own locked quote, key for key.
// Anything missing, unpriced or invented here must fail before a request is built.
export function expectedCart(items: readonly CartItem[], products: readonly Product[]): ExpectedLine[] | null {
  const lines: ExpectedLine[] = [];
  for (const item of items) {
    const line = cartLine(item, products);
    const price = line.variant?.price;
    if (!line.product || !line.available || typeof price !== 'number' || !Number.isSafeInteger(price) || price < 0) return null;
    lines.push({ product_id: line.product.id, variant_id: item.variantId, quantity: item.quantity, unit_price: price });
  }
  if (!lines.length) return null;
  return lines.sort((a, b) => a.variant_id.localeCompare(b.variant_id));
}
