import type { ScrollView, View } from 'react-native';

/** Anything measurable inside the scroll content: one field to follow, or a whole editor block to open. */
export type RevealerNode = { measureLayout: View['measureLayout'] };
export type FieldReveal = (node: RevealerNode | null) => void;
export type ScrollFrame = { offset: number; viewport: number; keyboard?: number };

/** The part of the scroll view the customer can actually see: Android overlays the keyboard instead of resizing the window. */
export function visibleBand(frame: ScrollFrame): { offset: number; viewport: number } {
  return { offset: frame.offset, viewport: Math.max(0, frame.viewport - (frame.keyboard ?? 0)) };
}

/**
 * `top` and `height` are measured inside the scroll content, so they stay stable while scrolling.
 * A field that is already fully inside the band keeps the offset untouched, so nothing jumps under the customer.
 * Any other field is placed at the top of the band, which leaves the room below it for the following fields and buttons.
 */
export function scrollOffsetToReveal(frame: ScrollFrame, field: { top: number; height: number }, gap: number): number {
  const band = visibleBand(frame);
  if (field.top >= band.offset + gap && field.top + field.height <= band.offset + band.viewport - gap) return frame.offset;
  return Math.max(0, field.top - gap);
}

/**
 * Reveals the given node, or the previously revealed one when called with null after the viewport changes.
 * Callers read their refs inside handlers, so this takes the live values rather than the refs themselves.
 */
export function revealField(hosts: { scroll: ScrollView | null; content: View | null; frame: ScrollFrame; gap?: number }, node: RevealerNode | null): void {
  const { scroll, content, frame } = hosts;
  const gap = hosts.gap ?? 24;
  if (!scroll || !content || !node || visibleBand(frame).viewport <= 0) return;
  node.measureLayout(content, (_x, top, _width, height) => {
    const next = scrollOffsetToReveal(frame, { top, height }, gap);
    if (next !== frame.offset) scroll.scrollTo({ y: next, animated: true });
  }, () => {});
}
