import { formatMoney } from '../../config/shop';
import { variantLabel } from '../products/variants';
import { orderStatuses, paymentStatuses, type EmailStatus, type OrderStatus, type PaymentStatus } from '../checkout/order';
import type { PaymentProvider } from '../checkout/checkout';

export const historyPageSize = 20;

const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const referencePattern = /^LH-[A-F0-9]{16}$/;
const referenceOf = (value: unknown) => typeof value === 'string' && referencePattern.test(value);

export type OrderSummary = {
  id: string; reference: string; placedAt: string; total: number; currency: 'NLE';
  fulfilment: 'delivery' | 'pickup'; status: OrderStatus; paymentStatus: PaymentStatus;
};
export type OrderLine = { key: string; name: string; options: string; quantity: number; unitPrice: number; lineTotal: number };
export type OrderDetail = OrderSummary & {
  customer: { name: string; phone: string; email: string };
  delivery: { street: string; area: string; city: string; zoneLabel: string; instructions: string } | null;
  pickupLocation: string | null;
  subtotal: number; fee: number; provider: PaymentProvider; phoneLast4: string | null; lines: OrderLine[];
};

const unreadable = () => new Error('This order record could not be read. Please retry.');

function text(value: unknown, maximum = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw unreadable();
  return value;
}
function optional(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  return text(value);
}
function money(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 2147483647) throw unreadable();
  return value as number;
}

// Every row is read under the customer's own row level security, so an unreadable field is a contract
// break rather than a reason to show half a record: the whole read is refused instead.
export function parseOrderSummary(value: unknown): OrderSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unreadable();
  const row = value as Record<string, unknown>;
  const id = text(row.id, 64);
  if (!identifier.test(id) || !referenceOf(row.order_reference) || row.currency !== 'NLE' ||
    !['delivery', 'pickup'].includes(String(row.fulfilment_method)) ||
    !(orderStatuses as readonly string[]).includes(String(row.status)) ||
    !(paymentStatuses as readonly string[]).includes(String(row.payment_status))) throw unreadable();
  const placedAt = text(row.created_at, 40);
  if (Number.isNaN(new Date(placedAt).getTime())) throw unreadable();
  return { id, reference: row.order_reference as string, placedAt, total: money(row.total_cents), currency: 'NLE',
    fulfilment: row.fulfilment_method as 'delivery' | 'pickup', status: row.status as OrderStatus, paymentStatus: row.payment_status as PaymentStatus };
}

function parseLine(value: unknown, position: number): OrderLine {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unreadable();
  const item = value as Record<string, unknown>;
  const quantity = item.quantity;
  if (!Number.isSafeInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 99) throw unreadable();
  const unitPrice = money(item.unit_price_cents);
  const snapshot = [item.variant_id, item.variant_sku, item.variant_options, item.variant_currency];
  let options = '';
  if (!snapshot.every(entry => entry === null || entry === undefined)) {
    if (typeof item.variant_id !== 'string' || !item.variant_id || typeof item.variant_sku !== 'string' || !item.variant_sku ||
      item.variant_currency !== 'NLE' || !item.variant_options || typeof item.variant_options !== 'object' || Array.isArray(item.variant_options)) throw unreadable();
    const entries = Object.entries(item.variant_options as Record<string, unknown>);
    if (entries.length > 8 || entries.some(([key, entry]) => !key.trim() || typeof entry !== 'string' || !entry.trim())) throw unreadable();
    options = variantLabel({ options: Object.fromEntries(entries) as Record<string, string> });
  }
  return { key: `${item.variant_id ?? 'item'}-${position}`, name: text(item.product_name, 200), options,
    quantity: quantity as number, unitPrice, lineTotal: (quantity as number) * unitPrice };
}

export function parseOrderDetail(value: unknown): OrderDetail {
  const base = parseOrderSummary(value);
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.order_items) || !row.order_items.length || row.order_items.length > 100 ||
    !['orange', 'afri'].includes(String(row.payment_provider))) throw unreadable();
  const lines = row.order_items.map(parseLine);
  const subtotal = money(row.subtotal_cents);
  const fee = money(row.delivery_fee_cents);
  // The stored record must add up before any of its money is shown: a broken snapshot is refused, not displayed.
  if (subtotal + fee !== base.total || lines.reduce((sum, line) => sum + line.lineTotal, 0) !== subtotal) throw unreadable();
  const delivery = row.delivery_street_address === null && row.delivery_area === null && row.delivery_city === null
    ? null : {
      street: text(row.delivery_street_address, 500), area: text(row.delivery_area, 200), city: text(row.delivery_city, 200),
      zoneLabel: optional(row.delivery_zone_label) ?? 'Delivery zone recorded at checkout',
      instructions: optional(row.delivery_instructions) ?? '',
    };
  return { ...base,
    customer: { name: text(row.full_name, 200), phone: text(row.customer_phone, 30), email: text(row.customer_email, 254) },
    delivery, pickupLocation: optional(row.pickup_location), subtotal, fee,
    provider: row.payment_provider as PaymentProvider, phoneLast4: optional(row.payment_phone_last4), lines };
}

export const moneyAt = (value: number) => formatMoney(value);

// 'awaiting_payment' is the state the trusted write path always starts an order in; the mobile app must
// never shorten it to a payment claim.
export function orderLabel(value: string) {
  if (value === 'awaiting_payment') return 'Awaiting confirmation';
  const spaced = value.replaceAll('_', ' ');
  return spaced.charAt(0).toLocaleUpperCase() + spaced.slice(1);
}

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const padded = (value: number) => String(value).padStart(2, '0');

// Built from date parts instead of Intl: Hermes does not guarantee locale formatting, and an order date
// that renders differently on two devices reads as two different orders.
export function orderDate(value: string) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return 'Date unavailable';
  return `${padded(at.getDate())} ${months[at.getMonth()]} ${at.getFullYear()}`;
}
export function orderDateTime(value: string) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return 'Date unavailable';
  return `${orderDate(value)}, ${padded(at.getHours())}:${padded(at.getMinutes())}`;
}

// The only three answers the order service gives about a confirmation email, each worded no further than
// the evidence behind it: queued is a bookkeeping state and provider acceptance is not delivery.
export const emailCopy: Record<EmailStatus, string> = {
  queued: 'The confirmation email is queued. Your order is saved while it waits, and nothing here proves it was delivered.',
  sent: 'The provider accepted the confirmation email for sending. That is acceptance, not proof that it arrived.',
  review_required: 'The confirmation email needs a manual review by the shop. Your order is saved.',
};
