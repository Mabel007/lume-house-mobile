import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';
export type ToastNotice = { variant: ToastVariant; title: string; description?: string };
type Shown = ToastNotice & { key: number };

const held: Record<ToastVariant, number> = { success: 3000, info: 4000, warning: 5000, error: 6000 };
const marks: Record<ToastVariant, string> = { success: '✓', error: '✕', warning: '!', info: 'i' };
const inks: Record<ToastVariant, string> = { success: '#535B40', error: '#9B2828', warning: '#8A5A00', info: '#665F52' };

// One slot, newest wins. A stack of banners would cover the controls the customer just used and every mount would
// announce itself again, so a repeated notice keeps its own identity and only restarts its dismissal timer.
export class ToastController {
  private shown: Shown | null = null;
  private sequence = 0;
  private stop: (() => void) | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly expire: (fire: () => void, delay: number) => () => void) {}
  getSnapshot = () => this.shown;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Shown | null) { this.shown = next; this.listeners.forEach(listener => listener()); }
  show(notice: ToastNotice) {
    const repeated = !!this.shown && this.shown.variant === notice.variant && this.shown.title === notice.title &&
      this.shown.description === notice.description;
    this.publish({ ...notice, key: repeated ? this.shown!.key : ++this.sequence });
    this.clear();
    this.stop = this.expire(() => { this.stop = null; this.publish(null); }, held[notice.variant]);
  }
  hide() { this.clear(); this.publish(null); }
  private clear() { if (this.stop) { this.stop(); this.stop = null; } }
}

export type ToastApi = { notify: (notice: ToastNotice) => void };
const silent: ToastApi = { notify: () => {} };
const ToastContext = createContext<ToastApi>(silent);
export function useToast() { return useContext(ToastContext); }

// No motion is started here at all: the notice appears, holds for its variant's duration and leaves. A device set to
// reduce motion therefore gets exactly the same presentation as one that is not, with nothing to suppress.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new ToastController((fire, delay) => {
    const timer = setTimeout(fire, delay);
    return () => { clearTimeout(timer); };
  }));
  const shown = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => controller.hide(), [controller]);
  return <ToastContext.Provider value={{ notify: notice => controller.show(notice) }}>
    {children}
    <View pointerEvents="none" style={styles.layer}>
      <SafeAreaView accessibilityLiveRegion="polite" style={styles.stack}>
        {shown ? <View key={shown.key} style={[styles.card, styles[shown.variant]]}>
          <Text accessibilityElementsHidden style={[styles.mark, { backgroundColor: inks[shown.variant] }]}>{marks[shown.variant]}</Text>
          <View style={styles.copy}>
            <Text style={styles.title}>{shown.title}</Text>
            {shown.description ? <Text style={styles.description}>{shown.description}</Text> : null}
          </View>
        </View> : null}
      </SafeAreaView>
    </View>
  </ToastContext.Provider>;
}

const styles = StyleSheet.create({
  // Absolute and non-interactive so the notice never sits in the layout flow or absorbs a tap meant for a control.
  layer: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  stack: { padding: 16, gap: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1,
    backgroundColor: '#FFFDF8' },
  mark: { width: 26, height: 26, borderRadius: 13, fontSize: 15, fontWeight: '700', lineHeight: 26, textAlign: 'center',
    color: '#FFFFFF', backgroundColor: '#535B40' },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600', color: '#292820' },
  description: { fontSize: 14, lineHeight: 21, color: '#423F38' },
  success: { borderColor: '#535B40' }, error: { borderColor: '#9B2828' }, warning: { borderColor: '#8A5A00' },
  info: { borderColor: '#A59C8B' },
});
