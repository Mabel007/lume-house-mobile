import type { EmailStatus } from '../checkout/order';

// What the order service answered about the confirmation email belongs to the screen only while this device made
// that placement. It is held in memory and never in a URL, so a typed, shared or deep-linked route cannot claim
// that a send was accepted, and the screen never asks the email service again just to find out.
let remembered: { orderId: string; status: EmailStatus } | null = null;

export function rememberPlacedEmail(orderId: string, status: EmailStatus) {
  remembered = { orderId, status };
}

export function placedEmail(orderId: string | null): EmailStatus | null {
  return remembered && orderId && remembered.orderId === orderId ? remembered.status : null;
}
