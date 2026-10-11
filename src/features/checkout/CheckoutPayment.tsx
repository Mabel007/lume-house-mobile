import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatMoney } from '../../config/shop';
import type { FieldReveal } from '../../lib/scrollReveal';
import { estimateLabels, estimatedTotals, maximumFieldLength, paymentPhone, paymentProviders,
  type CheckoutDraft, type CheckoutField, type CheckoutLine, type PaymentProvider } from './checkout';

type Props = {
  draft: CheckoutDraft;
  errors: Partial<Record<CheckoutField, string>>;
  lines: readonly CheckoutLine[];
  fee: number | null;
  busy: boolean;
  onChange: (changes: Partial<CheckoutDraft>) => void;
  onTouch: (field: CheckoutField) => void;
  revealField: FieldReveal;
};

const money = (value: number | null) => value === null ? 'Not priced yet' : formatMoney(value);

export function CheckoutPayment({ draft, errors, lines, fee, busy, onChange, onTouch, revealField }: Props) {
  const input = useRef<TextInput | null>(null);
  const reveal = useRef(revealField);
  useEffect(() => { reveal.current = revealField; });
  const labels = estimateLabels(draft, estimatedTotals(lines, fee));
  const error = errors.payment_phone;
  const row = (key: string, label: string, value: string, strong = false) => <View key={key} accessible
    accessibilityLabel={`${label}. ${value}`} accessibilityLiveRegion={strong ? 'polite' : undefined} style={styles.row}>
    <Text style={[styles.text, styles.rowLabel]}>{label}</Text>
    <Text style={[strong ? styles.total : styles.text, styles.rowValue]}>{value}</Text>
  </View>;
  return <View style={styles.surface}>
    <Text accessibilityRole="header" style={styles.heading}>Mobile money</Text>
    <Text style={styles.text}>Choose the number the shop should settle with. No payment is collected here, and this build does not check the number with a provider.</Text>
    <View style={styles.choices}>
      {(Object.keys(paymentProviders) as PaymentProvider[]).map(provider => <Pressable key={provider} accessibilityRole="radio"
        accessibilityLabel={paymentProviders[provider].name} accessibilityState={{ checked: draft.provider === provider, disabled: busy }}
        disabled={busy} onPress={() => onChange({ provider })} style={({ pressed }) => [styles.choice, draft.provider === provider && styles.selected, pressed && styles.pressed]}>
        <Text style={styles.choiceText}>{paymentProviders[provider].name}</Text>
      </Pressable>)}
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Mobile money number *</Text>
      <TextInput ref={instance => { input.current = instance; }} accessibilityLabel="Mobile money number *"
        accessibilityHint={error || 'Number format only; this does not verify registration with the selected provider.'}
        value={paymentPhone(draft)}
        onChangeText={value => onChange({ payment_phone: value })} onFocus={() => reveal.current(input.current ?? null)}
        onBlur={() => onTouch('payment_phone')}
        editable={!busy && !draft.reuse_phone}
        keyboardType="phone-pad" autoComplete="tel" autoCapitalize="none" maxLength={maximumFieldLength}
        style={[styles.input, draft.reuse_phone && styles.mirrored]} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
    <Pressable accessibilityRole="checkbox" accessibilityLabel="Use my contact phone number"
      accessibilityState={{ checked: draft.reuse_phone, disabled: busy }} disabled={busy}
      onPress={() => onChange({ reuse_phone: !draft.reuse_phone })} style={({ pressed }) => [styles.checkbox, pressed && styles.pressed]}>
      <Text style={styles.choiceText}>{`${draft.reuse_phone ? '☑' : '☐'} Use my contact phone number`}</Text>
    </Pressable>

    <Text accessibilityRole="header" style={styles.heading}>Order summary</Text>
    {lines.map(line => <View key={line.key} accessible accessibilityLabel={`${line.label}, quantity ${line.quantity}. ${line.available ? money(line.lineTotal) : 'No longer available'}`} style={styles.row}>
      <Text style={[styles.text, styles.rowLabel]}>{`${line.label} · ${line.quantity}`}</Text>
      <Text style={[styles.text, styles.rowValue]}>{line.available ? money(line.lineTotal) : 'No longer available'}</Text>
    </View>)}
    <View style={styles.rows}>
      {row('subtotal', 'Bag subtotal', labels.subtotal)}
      {row('fee', draft.fulfilment === 'pickup' ? 'Pickup' : 'Delivery', labels.fee)}
      {row('total', 'Estimated total', labels.total, true)}
    </View>
    <Text style={styles.note}>Totals are confirmed by the shop when the order is placed. This estimate is for your review only.</Text>
  </View>;
}

const styles = StyleSheet.create({
  surface: { gap: 14, padding: 20, borderRadius: 12, backgroundColor: '#FFFFFF' },
  field: { gap: 6 }, rows: { gap: 8 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' },
  // Both columns must be able to give way before either reaches the edge of the row: at large text the
  // value ("Delivery details needed") and a long line label overflowed the screen with flexShrink 0.
  // Neither column may grow, or a long label squeezes the price out of the row entirely.
  rowLabel: { flexShrink: 1 }, rowValue: { flexShrink: 1, textAlign: 'right' },
  heading: { fontSize: 21, color: '#292820' }, label: { fontSize: 16, fontWeight: '600', color: '#423F38' },
  text: { fontSize: 16, lineHeight: 25, color: '#423F38' }, note: { fontSize: 15, lineHeight: 23, color: '#665F52' },
  total: { fontSize: 18, fontWeight: '600', color: '#292820' }, error: { color: '#9B2828', fontSize: 16 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#797566', borderRadius: 8, padding: 12, fontSize: 16, color: '#292820' },
  mirrored: { backgroundColor: '#EEEBE1', color: '#665F52' },
  choices: { gap: 10 }, choice: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#797566' },
  checkbox: { minHeight: 48, justifyContent: 'center' },
  choiceText: { fontSize: 16, color: '#292820' }, selected: { borderColor: '#535B40', backgroundColor: '#EEEBE1' }, pressed: { opacity: 0.7 },
});
