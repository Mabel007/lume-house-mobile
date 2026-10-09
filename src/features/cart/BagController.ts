import { makeOperation, type CartAction, type CartItem, type CartOperation, type VariantCart } from './cart';
import { VariantCartError } from './variantCartRepository';

export type BagState = {
  status: 'loading' | 'ready' | 'saving' | 'error' | 'uncertain';
  items: CartItem[]; message: string | null; canRetry: boolean;
};
type Repository = { load: () => Promise<VariantCart>; change: (operation: CartOperation) => Promise<VariantCart> };
const uncertainMessage = 'Your change may have been saved. Refresh to see your Bag, or retry the saved change safely before making another.';

// One controller per authenticated lifecycle, with no optimistic cart or offline queue.
export class BagController {
  private state: BagState = { status: 'loading', items: [], message: null, canRetry: false };
  private pending: CartOperation | null = null;
  private busy = false;
  private epoch = 0;
  private active = false;
  private listeners = new Set<() => void>();
  constructor(private readonly repository: Repository, private readonly newId: () => string) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  isActive = () => this.active;
  activate() { this.active = true; }
  deactivate() {
    this.active = false; this.epoch += 1; this.busy = false;
    // Preserve an uncertain intent through effect cleanup/reconnect, never across users.
    this.publish({ status: 'loading', items: [], message: null, canRetry: false });
  }
  private current(epoch: number) { return this.active && this.epoch === epoch; }
  private publish(next: BagState) { this.state = next; this.listeners.forEach(listener => listener()); }

  refresh = async () => {
    if (!this.active || this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    this.publish({ ...this.state, status: 'loading', message: null });
    try {
      const cart = await this.repository.load();
      if (this.current(epoch)) this.publish({ items: cart.items, status: this.pending ? 'uncertain' : 'ready',
        message: this.pending ? uncertainMessage : null, canRetry: !!this.pending });
    } catch (reason) {
      if (this.current(epoch)) this.publish({ ...this.state, status: this.pending ? 'uncertain' : 'error',
        message: this.pending ? uncertainMessage : reason instanceof VariantCartError ? reason.message : 'Your Bag could not be loaded. Please refresh and try again.',
        canRetry: !!this.pending });
    } finally { if (this.current(epoch)) this.busy = false; }
  };

  dispatch = async (action: CartAction) => {
    if (!this.active || this.busy || this.pending || this.state.status !== 'ready') return false;
    const operation = makeOperation(this.state.items, action, this.newId);
    if (!operation) return false;
    this.pending = operation;
    return this.save(operation);
  };

  retry = async () => {
    if (!this.active || this.busy || !this.pending) return false;
    return this.save(this.pending);
  };

  private async save(operation: CartOperation) {
    const epoch = this.epoch;
    this.busy = true;
    this.publish({ ...this.state, status: 'saving', message: null, canRetry: false });
    try {
      const cart = await this.repository.change(operation);
      if (!this.current(epoch)) return false;
      this.pending = null;
      this.publish({ items: cart.items, status: 'ready', message: null, canRetry: false });
      return true;
    } catch (reason) {
      if (!this.current(epoch)) return false;
      const definite = reason instanceof VariantCartError && reason.definite;
      if (definite) this.pending = null;
      this.publish({ ...this.state, status: definite ? 'error' : 'uncertain', canRetry: !definite,
        message: definite ? reason.message : uncertainMessage });
      return false;
    } finally { if (this.current(epoch)) this.busy = false; }
  }
}
