export const shop = { name: 'Lumé House', currency: 'NLE', webOrigin: 'https://lume-house-delta.vercel.app' } as const;
export function formatMoney(minorUnits: number): string {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) throw new Error('Invalid money');
  return `NLe ${new Intl.NumberFormat('en-GB', { minimumFractionDigits: minorUnits % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(minorUnits / 100)}`;
}
