// Hermes has no guaranteed Intl.Segmenter and unicode property escapes are
// engine-dependent here, so initials use code points plus case probing:
// a character that has any case mapping is a letter, digits pass through.
const isMark = (part: string) => /\d/.test(part) || part.toLocaleUpperCase() !== part || part.toLocaleLowerCase() !== part;

export function accountInitials(name: string | null | undefined): string {
  const words = (name ?? '').normalize('NFC').trim().split(/\s+/u).map(word => Array.from(word)).filter(parts => parts.some(isMark));
  if (!words.length) return 'LH';
  const initial = (parts: string[]) => parts.find(isMark) ?? parts[0] ?? '';
  return (initial(words[0]) + (words.length > 1 ? initial(words[words.length - 1]) : '')).toLocaleUpperCase();
}
