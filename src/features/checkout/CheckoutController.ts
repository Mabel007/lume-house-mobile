import type { SupabaseClient } from '@supabase/supabase-js';
import { sessionToken, VariantCartError } from '../cart/variantCartRepository';
import type { CartItem } from '../cart/cart';
import type { Product } from '../products/products';
import { checkoutErrors, checkoutPayload, type CheckoutDraft } from './checkout';
import { expectedCart, type PlacedOrder } from './order';
import { OrderError, placeOrder, type PlaceRequest } from './orderRepository';

export type SubmitState = {
  status: 'idle' | 'submitting' | 'placed' | 'uncertain' | 'error';
  message: string | null; order: PlacedOrder | null; canRetry: boolean;
};
export type KeyStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyFor = (userId: string) => `lume:checkout-request:${userId}`;
const uncertainMessage = 'Your order could not be confirmed. Retry the same request, or check your orders before trying again.';

// The seam for a trusted submission. One request id per checkout attempt survives a lost response, so a retry
// re-sends identical arguments and the RPC returns the order it already created instead of a second one.
// Nothing in this build constructs or invokes it; the placement transport is an open owner decision.
export class CheckoutController {
  private state: SubmitState = { status: 'idle', message: null, order: null, canRetry: false };
  private attempt: PlaceRequest | null = null;
  private busy = false;
  private active = false;
  private epoch = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly client: SupabaseClient, private readonly userId: string,
    private readonly storage: KeyStorage, private readonly newId: () => string) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { this.active = true; }
  deactivate() {
    this.active = false; this.epoch += 1; this.busy = false; this.attempt = null;
    // The persisted request id stays behind for this identity: an order may already exist server-side.
    this.publish({ status: 'idle', message: null, order: null, canRetry: false });
  }
  private current(epoch: number) { return this.active && this.epoch === epoch; }
  private publish(next: SubmitState) { this.state = next; this.listeners.forEach(listener => listener()); }
  private refused(message: string) { this.publish({ status: 'error', message, order: null, canRetry: false }); return false; }

  submit = async (draft: CheckoutDraft, items: readonly CartItem[], products: readonly Product[]) => {
    if (!this.active || this.busy || this.attempt) return false;
    if (this.state.status === 'placed') return false;
    if (Object.keys(checkoutErrors(draft)).length) return this.refused('Please complete the highlighted checkout details first.');
    const cart = expectedCart(items, products);
    if (!cart) return this.refused('Your Bag prices need to refresh before an order can be placed.');
    const epoch = this.epoch;
    this.busy = true;
    let attempt: PlaceRequest;
    try {
      const stored = await this.storage.getItem(keyFor(this.userId));
      const candidate = stored && requestIdPattern.test(stored) ? stored : this.newId();
      if (!requestIdPattern.test(candidate)) throw new OrderError('INVALID_REQUEST');
      // Persisted before the request leaves the device, so a lost response is still retryable identically.
      await this.storage.setItem(keyFor(this.userId), candidate);
      attempt = { requestId: candidate, checkout: checkoutPayload(draft), expectedCart: cart };
    } catch {
      this.busy = false;
      return this.current(epoch) ? this.refused('Your order could not be prepared. Nothing was sent.') : false;
    }
    this.attempt = attempt;
    return this.send(attempt);
  };

  retry = async () => (this.active && !this.busy && this.attempt ? this.send(this.attempt) : false);

  private async send(attempt: PlaceRequest) {
    const epoch = this.epoch;
    this.busy = true;
    this.publish({ status: 'submitting', message: null, order: null, canRetry: false });
    try {
      const token = await sessionToken(this.client, this.userId, () => this.active);
      const order = await placeOrder(this.client, token, attempt);
      if (!this.current(epoch)) return false;
      this.attempt = null;
      await this.clearKey();
      this.publish({ status: 'placed', message: null, order, canRetry: false });
      return true;
    } catch (reason) {
      if (!this.current(epoch)) return false;
      // The shared session guard speaks about the Bag; a checkout customer hears the same fact in checkout words.
      const failure = reason instanceof VariantCartError && reason.code === 'AUTH_REQUIRED' ? new OrderError('AUTH_REQUIRED') : reason;
      const rejected = failure instanceof OrderError && failure.definite ? failure : null;
      if (rejected) { this.attempt = null; await this.clearKey(); }
      this.publish({ status: rejected ? 'error' : 'uncertain', order: null, canRetry: !rejected,
        message: rejected ? rejected.message : uncertainMessage });
      return false;
    } finally { if (this.current(epoch)) this.busy = false; }
  }

  private clearKey() { return this.storage.removeItem(keyFor(this.userId)).catch(() => {}); }
}
