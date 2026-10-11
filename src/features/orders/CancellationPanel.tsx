import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton } from '../../components/ActionButton';
import { getSupabaseClient } from '../../lib/supabase/client';
import { maximumReasonLength, type CancellationRequest } from './cancellation';
import { getCancellation, requestCancellation } from './cancellationRepository';
import { orderDateTime, orderLabel, type OrderDetail } from './orders';

const loadFailure = 'Your cancellation request could not be loaded. Check your connection and retry.';
const failure = (reason: unknown, fallback: string) =>
  (reason && typeof (reason as Error).message === 'string' && (reason as Error).message ? (reason as Error).message : fallback);

// Each word states what the shop's record says and no more: a request is a request, an acceptance is the
// shop's own order cancellation, and no branch of this contract mentions money returning.
const outcome: Record<CancellationRequest['status'], string> = {
  pending: 'Lumé House has your request. Nothing on this screen has cancelled the order or released stock.',
  accepted: 'Lumé House has cancelled this order. Cancellation does not issue a refund.',
  rejected: 'Lumé House has kept this order.',
  closed: 'This request is closed because the order moved on. The order itself has not been cancelled here.',
};

type Read = { key: string; status: 'loading' | 'ready' | 'error'; request: CancellationRequest | null; message: string | null };
type Send = { key: string; busy: boolean; message: string | null };

export function CancellationPanel({ userId, order }: { userId: string; order: OrderDetail }) {
  const [reason, setReason] = useState('');
  const [revision, setRevision] = useState(0);
  const [read, setRead] = useState<Read>({ key: '', status: 'loading', request: null, message: null });
  const [send, setSend] = useState<Send>({ key: '', busy: false, message: null });
  // A shop decision can move the order while this screen is open, so the order status is part of the key:
  // when it changes, the stored request is re-read instead of being shown from a stale answer.
  const readKey = `${userId}:${order.id}:${order.status}:${revision}`;
  const state = read.key === readKey ? read : { status: 'loading' as const, request: null, message: null };
  const sending = send.key === readKey ? send : { busy: false, message: null };
  // The reason first sent is the only reason the stored request can be retried with, because the shop answers
  // a different text with "a request already exists" instead of overwriting the one on file.
  const pendingReason = useRef<string | null>(null);
  const submitted = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let live = true;
    void getCancellation(getSupabaseClient(), userId, order.id, () => live && mounted.current)
      .then(request => { if (live) { pendingReason.current = null; setRead({ key: readKey, status: 'ready', request, message: null }); } })
      .catch(cause => { if (live) { pendingReason.current = null; setRead({ key: readKey, status: 'error', request: null, message: failure(cause, loadFailure) }); } });
    return () => { live = false; };
  }, [readKey, userId, order.id, order.status]);

  async function submit() {
    if (submitted.current) return;
    const trimmed = reason.trim();
    if (pendingReason.current !== null && pendingReason.current !== trimmed) {
      setSend({ key: readKey, busy: false, message: 'Retry with the reason you first sent, or reload to review the request you submitted.' });
      return;
    }
    submitted.current = true;
    pendingReason.current = trimmed;
    setSend({ key: readKey, busy: true, message: null });
    try {
      const request = await requestCancellation(getSupabaseClient(), userId, order.id, trimmed, () => mounted.current);
      if (mounted.current) {
        pendingReason.current = null;
        setRead({ key: readKey, status: 'ready', request, message: null });
        setSend({ key: readKey, busy: false, message: null });
      }
    } catch (cause) {
      // The request may exist at the shop even when this answer was lost, so the retry keeps its own reason.
      if (mounted.current) setSend({ key: readKey, busy: false, message: failure(cause, 'The cancellation request could not be confirmed. Reload to review it before retrying.') });
    } finally { submitted.current = false; }
  }

  const eligible = order.status === 'placed' || order.status === 'confirmed';
  const request = state.request;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>Cancellation request</Text>
    <View style={styles.rows}>
      <Text style={styles.note}>A request is not immediate cancellation. Lumé House confirmation is required. Cancellation does not issue a refund.</Text>
      {state.status === 'loading' ? <View accessibilityLiveRegion="polite" style={styles.row}>
        <ActivityIndicator color="#535B40" accessibilityLabel="Loading your cancellation request" />
        <Text style={styles.text}>Loading your cancellation request…</Text>
      </View> : null}
      {state.status === 'error' ? <>
        <Text accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.text}>{state.message}</Text>
        <ActionButton label="Reload request" secondary busy={sending.busy} disabled={sending.busy}
          accessibilityLabel="Reload the cancellation request for this order" onPress={() => setRevision(value => value + 1)} />
      </> : null}
      {state.status === 'ready' && request ? <Record request={request} /> : null}
      {state.status === 'ready' && !request && !eligible ? <Text style={styles.text}>This order is no longer eligible for a cancellation request.</Text> : null}
      {sending.message ? <Text accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.text}>{sending.message}</Text> : null}
      {state.status === 'ready' && !request && eligible ? <>
        <Text style={styles.text}>Reason (optional)</Text>
        <TextInput accessibilityLabel="Reason for the cancellation request" accessibilityHint="Optional, up to 500 characters. This sends a request only; it does not cancel the order."
          value={reason} onChangeText={setReason} editable={!sending.busy} maxLength={maximumReasonLength} multiline
          placeholder="Tell the shop why you are requesting this" placeholderTextColor="#8A8271" style={styles.input} />
        <ActionButton label={sending.busy ? 'Sending your request…' : 'Request cancellation'} busy={sending.busy} disabled={sending.busy}
          accessibilityLabel="Send a cancellation request for this order" onPress={() => void submit()} />
        <Text style={styles.note}>Sending this button records your request with Lumé House. It does not change the order status, payment state or stock.</Text>
      </> : null}
    </View>
  </View>;
}

function Record({ request }: { request: CancellationRequest }) {
  return <View accessible accessibilityLiveRegion="polite"
    accessibilityLabel={`Cancellation request ${orderLabel(request.status)}. Requested ${orderDateTime(request.requested_at)}. ${request.reason ? `Your reason: ${request.reason}.` : 'No reason was given.'} ${outcome[request.status]}`}
    style={styles.record}>
    <Text style={styles.pill}>{`Cancellation request: ${orderLabel(request.status)}`}</Text>
    <Text style={styles.text}>{`Requested ${orderDateTime(request.requested_at)}`}</Text>
    <Text style={styles.text}>{request.reason ? `Your reason: ${request.reason}` : 'No reason was given with the request.'}</Text>
    <Text style={styles.text}>{outcome[request.status]}</Text>
    {request.status !== 'pending' ? <Text style={styles.text}>
      {`Recorded ${request.resolved_at ? orderDateTime(request.resolved_at) : 'without a time in this record'}.`}
    </Text> : null}
    {request.resolution ? <Text style={styles.text}>Shop resolution: {request.resolution}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  rows: { gap: 8 },
  sectionTitle: { fontSize: 19, fontWeight: '600', color: '#292820' },
  text: { fontSize: 16, lineHeight: 25, color: '#423F38' },
  note: { fontSize: 15, lineHeight: 23, color: '#665F52' },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#EEEBE1', color: '#535B40', fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  record: { gap: 6, padding: 14, borderRadius: 10, backgroundColor: '#EFEBE1' },
  input: { minHeight: 96, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#D9D2C4', backgroundColor: '#FFFDF8', color: '#292820', fontSize: 16, lineHeight: 24 },
});
