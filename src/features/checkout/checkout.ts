import { getDeliveryFee, type Fulfilment } from '../../config/fulfilment';
import { formatMoney } from '../../config/shop';
import { normalizePhone, type Profile } from '../profile/profile';

export type PaymentProvider = 'orange' | 'afri';
// Provider selection is metadata only: no gateway is integrated and no number is verified.
export const paymentProviders: Record<PaymentProvider, { name: string }> = {
  orange: { name: 'Orange Money' },
  afri: { name: 'Afrimoney' },
};

export const maximumFieldLength = 200;
export const maximumInstructionsLength = 500;
export const maximumEmailLength = 254;

export type CheckoutField = 'full_name' | 'contact_phone' | 'email' | 'street' | 'area' | 'city' | 'zone' | 'instructions' | 'payment_phone';
export type CheckoutDraft = {
  full_name: string; contact_phone: string; email: string; fulfilment: Fulfilment;
  street: string; area: string; city: string; zone: string; instructions: string;
  provider: PaymentProvider; payment_phone: string; reuse_phone: boolean;
};

export const emptyCheckout: CheckoutDraft = {
  full_name: '', contact_phone: '', email: '', fulfilment: 'delivery', street: '', area: '', city: '',
  zone: '', instructions: '', provider: 'orange', payment_phone: '', reuse_phone: false,
};

// Saved profile defaults are a starting point only: they land in this independent draft and nothing writes back.
export function checkoutDefaults(profile: Profile, email: string): CheckoutDraft {
  return { ...emptyCheckout, full_name: profile.full_name, contact_phone: profile.phone, email,
    street: profile.default_street_address, area: profile.default_area, city: profile.default_city };
}

export function paymentPhone(draft: CheckoutDraft): string {
  return draft.reuse_phone ? draft.contact_phone : draft.payment_phone;
}

const prefillFields = ['full_name', 'contact_phone', 'email', 'street', 'area', 'city'] as const;

// One-shot prefill: only an untouched field receives a saved default, and the draft is never written back to the profile.
export function prefillDefaults(draft: CheckoutDraft, profile: Profile, email: string): CheckoutDraft {
  const source = checkoutDefaults(profile, email);
  const next = { ...draft };
  for (const key of prefillFields) if (!next[key].trim() && source[key].trim()) next[key] = source[key];
  return next;
}

export function deliveryFee(draft: CheckoutDraft): number | null {
  return getDeliveryFee(draft.fulfilment, draft.city, draft.zone);
}

export function deliveryNotice(draft: CheckoutDraft): string | null {
  if (draft.fulfilment !== 'delivery' || !draft.city.trim()) return null;
  return getDeliveryFee('delivery', draft.city, draft.zone) === null && draft.city.trim().toLowerCase() !== 'freetown' ?
    'Delivery is currently limited to Freetown.' : null;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneMessage = 'Enter a Sierra Leone phone number, for example +23276521208.';
const mobileMessage = 'Enter a Sierra Leone mobile number, for example +23276521208.';

export function checkoutErrors(draft: CheckoutDraft): Partial<Record<CheckoutField, string>> {
  const errors: Partial<Record<CheckoutField, string>> = {};
  const bounded = (field: CheckoutField, value: string, missing: string, maximum = maximumFieldLength) => {
    const trimmed = value.trim();
    if (!trimmed) errors[field] = missing;
    else if (trimmed.length > maximum) errors[field] = `Please keep this field within ${maximum} characters.`;
    return trimmed;
  };
  const slNumber = (value: string) => /^\+232\d{8}$/.test(normalizePhone(value));
  bounded('full_name', draft.full_name, 'Enter your full name.');
  const contact = bounded('contact_phone', draft.contact_phone, phoneMessage);
  if (contact && !slNumber(contact)) errors.contact_phone = phoneMessage;
  const email = bounded('email', draft.email, 'Enter an email address for your order confirmation.', maximumEmailLength);
  if (email && !errors.email && !emailPattern.test(email)) errors.email = 'Enter a valid email address.';
  const payment = bounded('payment_phone', paymentPhone(draft), mobileMessage);
  if (payment && !errors.payment_phone && !slNumber(payment)) errors.payment_phone = mobileMessage;
  if (draft.instructions.trim().length > maximumInstructionsLength) {
    errors.instructions = `Please keep delivery instructions within ${maximumInstructionsLength} characters.`;
  }
  if (draft.fulfilment === 'delivery') {
    bounded('street', draft.street, 'Enter your street address or a landmark.');
    bounded('area', draft.area, 'Enter your area or community.');
    bounded('city', draft.city, 'Enter your city or town.');
    if (!draft.zone) errors.zone = 'Choose a supported Freetown delivery zone.';
  }
  return errors;
}

export type EstimatedLine = { available: boolean; lineTotal: number | null };
export type CheckoutLine = EstimatedLine & { key: string; label: string; quantity: number };
export type Estimate = { subtotal: number | null; fee: number | null; total: number | null; complete: boolean };

// An estimate for review only. place_variant_order recomputes every figure from locked database rows.
export function estimatedTotals(lines: readonly EstimatedLine[], fee: number | null): Estimate {
  const complete = lines.length > 0 && lines.every(line => line.available && typeof line.lineTotal === 'number');
  const subtotal = lines.reduce((sum, line) => sum + (line.available ? line.lineTotal ?? 0 : 0), 0);
  if (!complete) return { subtotal: null, fee, total: null, complete: false };
  return { subtotal, fee, total: fee === null ? null : subtotal + fee, complete: true };
}

// The web Bag never claims a total it cannot resolve, and neither does this screen.
export function estimateLabels(draft: CheckoutDraft, estimate: Estimate) {
  const { subtotal, fee, total } = estimate;
  return {
    subtotal: subtotal === null ? 'Prices unavailable yet' : formatMoney(subtotal),
    // Pickup is free because place_variant_order sets the fulfilment fee to zero, not because a courier agreed.
    fee: fee === null ? 'Choose at checkout' : draft.fulfilment === 'pickup' ? 'Free with pickup' : formatMoney(fee),
    total: total !== null ? formatMoney(total) : subtotal === null ? 'Prices unavailable yet' : 'Delivery details needed',
  };
}

export function checkoutPayload(draft: CheckoutDraft) {  return {
    full_name: draft.full_name.trim(), email: draft.email.trim(), contact_phone: normalizePhone(draft.contact_phone),
    payment_phone: normalizePhone(paymentPhone(draft)), provider: draft.provider, fulfilment: draft.fulfilment,
    zone_id: draft.zone, street: draft.street.trim(), area: draft.area.trim(), city: draft.city.trim(),
    instructions: draft.instructions.trim(),
  };
}

export type CheckoutPayload = ReturnType<typeof checkoutPayload>;
