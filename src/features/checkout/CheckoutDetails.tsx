import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { deliveryConfig } from '../../config/fulfilment';
import { formatMoney } from '../../config/shop';
import type { FieldReveal } from '../../lib/scrollReveal';
import { maximumFieldLength, maximumInstructionsLength, type CheckoutDraft, type CheckoutField } from './checkout';

type Props = {
  draft: CheckoutDraft;
  errors: Partial<Record<CheckoutField, string>>;
  notice: string | null;
  busy: boolean;
  onChange: (changes: Partial<CheckoutDraft>) => void;
  onTouch: (field: CheckoutField) => void;
  revealField: FieldReveal;
};

type FieldOptions = { keyboardType?: 'default' | 'email-address' | 'phone-pad'; autoComplete?: 'name' | 'tel' | 'email' | 'street-address' | 'off';
  autoCapitalize?: 'none' | 'words'; multiline?: boolean; maximum?: number; hint?: string };

export function CheckoutDetails({ draft, errors, notice, busy, onChange, onTouch, revealField }: Props) {
  const inputs = useRef<Partial<Record<CheckoutField, TextInput | null>>>({});
  const deliveryBlock = useRef<View | null>(null);
  const openedDelivery = useRef(false);
  const reveal = useRef(revealField);
  useEffect(() => { reveal.current = revealField; });
  function field(key: CheckoutField, label: string, options: FieldOptions = {}) {
    const error = errors[key];
    return <View style={styles.field} key={key}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} accessibilityHint={error || options.hint} value={draft[key]} editable={!busy}
        ref={instance => { inputs.current[key] = instance; }} onFocus={() => reveal.current(inputs.current[key] ?? null)}
        onBlur={() => onTouch(key)}
        onChangeText={value => onChange({ [key]: value })} keyboardType={options.keyboardType ?? 'default'}
        autoComplete={options.autoComplete ?? 'off'} autoCapitalize={options.autoCapitalize ?? 'none'}
        multiline={options.multiline} maxLength={options.maximum ?? maximumFieldLength}
        style={[styles.input, options.multiline && styles.multiline]} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>;
  }
  return <View style={styles.surface}>
    <Text accessibilityRole="header" style={styles.heading}>Contact information</Text>
    {field('full_name', 'Full name *', { autoComplete: 'name', autoCapitalize: 'words', hint: 'Required for your order.' })}
    {field('contact_phone', 'Phone number *', { keyboardType: 'phone-pad', autoComplete: 'tel', hint: 'A Sierra Leone number, for example +23276521208.' })}
    {field('email', 'Email *', { keyboardType: 'email-address', autoComplete: 'email', hint: 'Where your order confirmation is sent.' })}
    <Text style={styles.text}>Your profile defaults are filled in. Checkout edits apply here only.</Text>

    <Text accessibilityRole="header" style={styles.heading}>Delivery or pickup</Text>
    <View style={styles.choices}>
      {(['delivery', 'pickup'] as const).map(option => <Pressable key={option} accessibilityRole="radio"
        accessibilityLabel={option === 'delivery' ? 'Delivery' : 'Pickup'} accessibilityState={{ checked: draft.fulfilment === option, disabled: busy }}
        disabled={busy} onPress={() => { openedDelivery.current = option === 'delivery'; onChange({ fulfilment: option }); }} style={({ pressed }) => [styles.choice, draft.fulfilment === option && styles.selected, pressed && styles.pressed]}>
        <Text style={styles.choiceText}>{option === 'delivery' ? 'Delivery' : 'Pickup'}</Text>
      </Pressable>)}
    </View>
    {draft.fulfilment === 'pickup' ? <Text style={styles.text}>Pickup in {deliveryConfig.pickupLocation}. No delivery fee.</Text> : <View ref={instance => { deliveryBlock.current = instance; }}
      // Only the customer's own choice of Delivery may move the view; an error appearing or clearing must not drag the scroll.
      onLayout={() => { if (!openedDelivery.current) return; openedDelivery.current = false; reveal.current(deliveryBlock.current); }} style={styles.group}>
      <Text style={styles.text}>Delivery in {deliveryConfig.serviceCity}. Choose the zone that best matches your address. These delivery fees are provisional.</Text>
      {field('street', 'Street address / landmark *', { autoComplete: 'street-address', autoCapitalize: 'words', hint: 'A landmark helps the delivery.' })}
      {field('area', 'Area / community *', { autoCapitalize: 'words', hint: 'Required for delivery orders.' })}
      {field('city', 'City / town *', { autoCapitalize: 'words', hint: notice || 'Delivery is currently limited to Freetown.' })}
      {notice ? <Text accessibilityRole="alert" style={styles.text}>{notice}</Text> : null}
      <Text style={styles.label}>Delivery zone *</Text>
      {deliveryConfig.zones.map(zone => <Pressable key={zone.id} accessibilityRole="radio"
        accessibilityLabel={`${zone.coverage}. Delivery ${formatMoney(zone.fee)}.`}
        accessibilityState={{ checked: draft.zone === zone.id, disabled: busy }} disabled={busy}
        onPress={() => { onTouch('zone'); onChange({ zone: zone.id }); }} style={({ pressed }) => [styles.choice, styles.zone, draft.zone === zone.id && styles.selected, pressed && styles.pressed]}>
        <Text style={[styles.choiceText, styles.zoneLabel]}>{zone.coverage}</Text>
        <Text style={styles.zoneFee}>{formatMoney(zone.fee)}</Text>
      </Pressable>)}
      {errors.zone ? <Text accessibilityRole="alert" style={styles.error}>{errors.zone}</Text> : null}
      {field('instructions', 'Delivery instructions (optional)', { multiline: true, maximum: maximumInstructionsLength, hint: 'Anything useful for the delivery.' })}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  surface: { gap: 14, padding: 20, borderRadius: 12, backgroundColor: '#FFFFFF' },
  group: { gap: 14 }, field: { gap: 6 },
  heading: { fontSize: 21, color: '#292820' }, label: { fontSize: 16, fontWeight: '600', color: '#423F38' },
  text: { fontSize: 16, lineHeight: 25, color: '#423F38' }, error: { color: '#9B2828', fontSize: 16 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#797566', borderRadius: 8, padding: 12, fontSize: 16, color: '#292820' },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  choices: { gap: 10 }, choice: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#797566' },
  zone: { justifyContent: 'flex-start' }, zoneLabel: { flex: 1 }, selected: { borderColor: '#535B40', backgroundColor: '#EEEBE1' }, pressed: { opacity: 0.7 },
  choiceText: { fontSize: 16, color: '#292820' }, zoneFee: { fontSize: 16, color: '#535B40', fontWeight: '600' },
});
