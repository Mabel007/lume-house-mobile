import type { SupabaseClient } from '@supabase/supabase-js';
import { emailStatus, type EmailStatus } from '../checkout/order';
import { historyPageSize, parseOrderDetail, parseOrderSummary, type OrderDetail, type OrderSummary } from './orders';

// The exact columns the existing owner-scoped SELECT policies expose, and no more: a mobile order reads
// the same record the website reads, through the same row level security.
const summaryColumns = 'id,order_reference,created_at,total_cents,currency,fulfilment_method,status,payment_status';
const detailColumns = `${summaryColumns},full_name,customer_email,customer_phone,delivery_street_address,delivery_area,` +
  'delivery_city,delivery_zone_label,delivery_instructions,pickup_location,payment_provider,payment_phone_last4,' +
  'subtotal_cents,delivery_fee_cents,order_items(product_name,quantity,unit_price_cents,variant_id,variant_sku,variant_options,variant_currency)';

export async function requireOwner(client: SupabaseClient, userId: string, active: () => boolean) {
  const { data, error } = await client.auth.getUser();
  if (error || data.user?.id !== userId || !active()) throw new Error('Please sign in again to view your orders.');
  return data.user.id;
}

export async function loadOrders(client: SupabaseClient, userId: string, page: number, active: () => boolean): Promise<OrderSummary[]> {
  await requireOwner(client, userId, active);
  const { data, error } = await client.from('orders').select(summaryColumns)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(page * historyPageSize, (page + 1) * historyPageSize - 1);
  if (error) throw new Error('Your orders could not be loaded. Check your connection and retry.');
  if (!Array.isArray(data)) throw new Error('Your orders could not be loaded. Check your connection and retry.');
  return data.map(parseOrderSummary);
}

// null is the answer RLS gives for an order that is not this customer's, and for one that does not exist.
// Both read the same way here, because the app is not allowed to tell them apart.
export async function loadOrder(client: SupabaseClient, userId: string, orderId: string, active: () => boolean): Promise<OrderDetail | null> {
  await requireOwner(client, userId, active);
  const { data, error } = await client.from('orders').select(detailColumns).eq('id', orderId).maybeSingle();
  if (error) throw new Error('This order could not be loaded. Check your connection and retry.');
  return data ? parseOrderDetail(data) : null;
}

// Asking about the email is the website's own customer control: the function re-checks ownership under RLS
// before it touches the privileged job row, and a failure here never speaks about the order.
export async function checkConfirmation(client: SupabaseClient, userId: string, orderId: string, active: () => boolean): Promise<EmailStatus> {
  const owner = await requireOwner(client, userId, active);
  const { data: { session } } = await client.auth.getSession();
  if (!session || session.user.id !== owner || !active()) throw new Error('Please sign in again to view your orders.');
  const { data, error } = await client.functions.invoke('order-email', {
    body: { order_id: orderId }, headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw new Error('The confirmation email status could not be checked. Your order is still saved.');
  return emailStatus((data as { email_status?: unknown } | null)?.email_status);
}
