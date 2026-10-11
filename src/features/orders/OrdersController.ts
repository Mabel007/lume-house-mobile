import { historyPageSize, type OrderSummary } from './orders';

export type OrdersState = {
  status: 'loading' | 'ready' | 'error'; orders: OrderSummary[]; message: string | null;
  older: boolean; loadingMore: boolean;
};

const idle: OrdersState = { status: 'loading', orders: [], message: null, older: false, loadingMore: false };

// A page that arrives with fewer rows than the page size is the end of the history, so the screen never
// offers an empty "load more" and never claims a list is complete while one is still unasked for.
const complete = (orders: readonly OrderSummary[]) => orders.length === historyPageSize;

// Newest first, one page at a time, under the customer the screen passed in: this class holds no session,
// no token and no order of its own.
export class OrdersController {
  private state: OrdersState = idle;
  private owner = '';
  private pages = 0;
  private active = false;
  private busy = false;
  private epoch = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly read: (userId: string, page: number) => Promise<OrderSummary[]>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  isActive = () => this.active;
  activate() { this.active = true; }
  deactivate() { this.active = false; this.epoch += 1; this.busy = false; this.owner = ''; this.pages = 0; this.publish(idle); }
  private current(epoch: number) { return this.active && this.epoch === epoch; }
  private publish(next: OrdersState) { this.state = next; this.listeners.forEach(listener => listener()); }

  refresh = async (userId: string) => {
    if (!this.active || this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    this.publish({ ...idle, message: null });
    try {
      const orders = await this.read(userId, 0);
      if (!this.current(epoch)) return;
      this.owner = userId;
      this.pages = 1;
      this.publish({ status: 'ready', orders, message: null, older: complete(orders), loadingMore: false });
    } catch {
      if (this.current(epoch)) this.publish({ status: 'error', orders: [], message: 'Your orders could not be loaded. Check your connection and retry.', older: false, loadingMore: false });
    } finally { if (this.current(epoch)) this.busy = false; }
  };

  loadMore = async () => {
    if (!this.active || this.busy || this.state.status !== 'ready' || !this.state.older) return;
    const epoch = this.epoch;
    const userId = this.owner;
    this.busy = true;
    this.publish({ ...this.state, loadingMore: true, message: null });
    try {
      const next = await this.read(userId, this.pages);
      if (!this.current(epoch)) return;
      this.pages += 1;
      const seen = new Set(this.state.orders.map(order => order.id));
      this.publish({ status: 'ready', orders: [...this.state.orders, ...next.filter(order => !seen.has(order.id))],
        message: null, older: complete(next), loadingMore: false });
    } catch {
      if (this.current(epoch)) this.publish({ ...this.state, loadingMore: false,
        message: 'Earlier orders could not be loaded. The orders above are unchanged.' });
    } finally { if (this.current(epoch)) this.busy = false; }
  };
}
