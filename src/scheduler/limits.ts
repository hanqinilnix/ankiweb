// Port of rslib/src/decks/{limits,counts,stats}.rs and custom_study extend limits.
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import type { Deck, DeckCommon, DeckConfig } from '../model/types';

export type LimitKind = 'review' | 'new';
export interface RemainingLimits { review: number; new: number; capNewToReview: boolean }
const DEFAULT: RemainingLimits = { review: 9999, new: 9999, capNewToReview: false };

const limitIfToday = (l: { limit: number; today: number } | undefined, today: number) => (l && l.today === today ? l.limit : undefined);
export const currentReviewLimit = (d: Deck, today: number) => limitIfToday(d.normal.reviewLimitToday, today) ?? d.normal.reviewLimit;
export const currentNewLimit = (d: Deck, today: number) => limitIfToday(d.normal.newLimitToday, today) ?? d.normal.newLimit;

export const newRevCounts = (d: Deck, today: number): [number, number] =>
  d.common.lastDayStudied === today ? [d.common.newStudied, d.common.reviewStudied] : [0, 0];

export function remainingLimits(deck: Deck, cfg: DeckConfig | undefined, today: number, newIgnoreRev: boolean): RemainingLimits {
  if (!cfg) return { ...DEFAULT };
  let review = currentReviewLimit(deck, today) ?? cfg.revPerDay;
  let nw = currentNewLimit(deck, today) ?? cfg.newPerDay;
  const [newToday, revToday] = newRevCounts(deck, today);
  review -= revToday;
  nw -= newToday;
  if (!newIgnoreRev) { review -= newToday; nw = Math.min(nw, review); }
  return { review: Math.max(0, review), new: Math.max(0, nw), capNewToReview: !newIgnoreRev };
}

export const capTo = (a: RemainingLimits, b: RemainingLimits): RemainingLimits => ({ ...a, review: Math.min(a.review, b.review), new: Math.min(a.new, b.new) });

// LimitTreeMap: decks must be in name order with the root first; children capped to parents.
export class LimitTree {
  private limits = new Map<number, RemainingLimits>();
  private parents = new Map<number, number>();
  readonly rootId: number;
  constructor(decks: Deck[], cfgs: Map<number, DeckConfig>, today: number, newIgnoreRev: boolean) {
    this.rootId = decks[0]!.id;
    const stack: Deck[] = [];
    for (const d of decks) {
      const level = d.name.split('::').length;
      while (stack.length && stack[stack.length - 1]!.name.split('::').length >= level) stack.pop();
      let lim = remainingLimits(d, cfgs.get(d.confId), today, newIgnoreRev);
      const parent = stack[stack.length - 1];
      if (parent) { lim = capTo(lim, this.limits.get(parent.id)!); this.parents.set(d.id, parent.id); }
      this.limits.set(d.id, lim);
      stack.push(d);
    }
  }
  get(id: number) { return this.limits.get(id) ?? DEFAULT; }
  root() { return this.get(this.rootId); }
  rootReached(k: LimitKind) { return this.root()[k] === 0; }
  reached(id: number, k: LimitKind) { return this.get(id)[k] === 0; }
  private decrementOne(id: number, k: LimitKind) {
    const l = { ...this.get(id) };
    if (k === 'review') { l.review = Math.max(0, l.review - 1); if (l.capNewToReview) l.new = Math.min(l.new, l.review); }
    else l.new = Math.max(0, l.new - 1);
    this.limits.set(id, l);
    return l.review === 0 || l.new === 0;
  }
  // Decrement deck and all parents; when a parent hits 0, cap its descendants.
  decrement(id: number, k: LimitKind) {
    let cur: number | undefined = id;
    while (cur !== undefined) {
      if (this.decrementOne(cur, k)) this.capDescendants(cur);
      cur = this.parents.get(cur);
    }
  }
  private capDescendants(id: number) {
    const lim = this.get(id);
    for (const [child, parent] of this.parents) if (parent === id) { this.limits.set(child, capTo(this.get(child), lim)); this.capDescendants(child); }
  }
}

// stats.rs
export function resetStatsIfDayChanged(c: DeckCommon, today: number): DeckCommon {
  return c.lastDayStudied === today ? c : { lastDayStudied: today, newStudied: 0, learningStudied: 0, reviewStudied: 0, msStudied: 0 };
}
export const applyStats = (d: Deck, today: number, f: (c: DeckCommon) => DeckCommon): Deck => ({ ...d, common: f(resetStatsIfDayChanged(d.common, today)) });
export const statsDelta = (nw: number, rev: number, ms: number) => (c: DeckCommon): DeckCommon =>
  ({ ...c, newStudied: c.newStudied + nw, reviewStudied: c.reviewStudied + rev, msStudied: c.msStudied + ms });
// extend_limits: positive delta raises today's limit by lowering the "done today" count.
export const extendDelta = (nw: number, rev: number) => (c: DeckCommon): DeckCommon =>
  ({ ...c, newStudied: c.newStudied - nw, reviewStudied: c.reviewStudied - rev });
