import { emptyProfile, profileErrors, type Profile, type ProfileField } from './profile';
export type ProfileState = { status: 'loading' | 'ready' | 'saving' | 'error'; saved: Profile; draft: Profile; errors: Partial<Record<ProfileField, string>>; message: string | null };
type Repository = { load: () => Promise<Profile>; save: (profile: Profile, fields: readonly ProfileField[]) => Promise<Profile> };
export class ProfileController {
  private state: ProfileState = { status: 'loading', saved: { ...emptyProfile }, draft: { ...emptyProfile }, errors: {}, message: null };
  private active = false;
  private epoch = 0;
  private busy = false;
  private listeners = new Set<() => void>();
  constructor(private readonly repository: Repository) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  isActive = () => this.active;
  activate() { this.active = true; }
  deactivate() { this.active = false; this.epoch++; this.busy = false; this.publish({ status: 'loading', saved: { ...emptyProfile }, draft: { ...emptyProfile }, errors: {}, message: null }); }
  private publish(state: ProfileState) { this.state = state; this.listeners.forEach(listener => listener()); }
  private current(epoch: number) { return this.active && this.epoch === epoch; }
  edit = (key: ProfileField, value: string) => {
    if (!this.active || this.busy || this.state.status !== 'ready') return;
    this.publish({ ...this.state, draft: { ...this.state.draft, [key]: value }, errors: { ...this.state.errors, [key]: undefined }, message: null });
  };
  cancel = () => { if (this.active && !this.busy) this.publish({ ...this.state, draft: { ...this.state.saved }, errors: {}, message: null }); };
  refresh = async () => {
    if (!this.active || this.busy) return;
    const epoch = this.epoch; this.busy = true;
    this.publish({ ...this.state, status: 'loading', message: null, errors: {} });
    try { const saved = await this.repository.load(); if (this.current(epoch)) this.publish({ status: 'ready', saved, draft: { ...saved }, errors: {}, message: null }); }
    catch { if (this.current(epoch)) this.publish({ ...this.state, status: 'error', message: 'Your details could not be loaded. Check your connection and retry.' }); }
    finally { if (this.current(epoch)) this.busy = false; }
  };
  save = async (fields: readonly ProfileField[]) => {
    if (!this.active || this.busy || this.state.status !== 'ready') return false;
    const errors = profileErrors(this.state.draft);
    const selectedErrors = Object.fromEntries(fields.filter(key => errors[key]).map(key => [key, errors[key]]));
    if (Object.keys(selectedErrors).length) { this.publish({ ...this.state, errors: selectedErrors, message: 'Please check the highlighted fields.' }); return false; }
    const epoch = this.epoch; this.busy = true;
    this.publish({ ...this.state, status: 'saving', message: null, errors: {} });
    try { const saved = await this.repository.save(this.state.draft, fields); if (!this.current(epoch)) return false;
      this.publish({ status: 'ready', saved, draft: { ...saved }, errors: {}, message: 'Your details have been saved.' }); return true;
    } catch { if (this.current(epoch)) this.publish({ ...this.state, status: 'ready', message: 'We could not confirm your save. Refresh to check your details before retrying.' }); return false; }
    finally { if (this.current(epoch)) this.busy = false; }
  };
}
