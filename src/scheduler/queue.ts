// Port of rslib/src/scheduler/queue/builder/{mod,gathering,sorting,burying,intersperser}.rs
// and storage/card new/due ordering SQL. Pure: takes cards in memory.
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import { CardType, NewGather, NewSort, Queue, ReviewMix, ReviewOrder, type Card, type Collection, type Deck, type DeckConfig } from '../model/types';
import { cmpBig, fnvhash } from './fnv';
import { LimitTree } from './limits';
import type { SchedTimingToday } from './timing';

export interface BuryMode { buryNew: boolean; buryReviews: boolean; buryInterdayLearning: boolean }
export const buryModeOf = (c: DeckConfig | undefined): BuryMode =>
  ({ buryNew: !!c?.buryNew, buryReviews: !!c?.buryReviews, buryInterdayLearning: !!c?.buryInterdayLearning });
export const anyBurying = (m: BuryMode) => m.buryNew || m.buryReviews || m.buryInterdayLearning;

export type EntryKind = 'new' | 'review' | 'learning';
export interface QueueEntry { id: number; kind: EntryKind; due: number; reps: number }
export interface Counts { new: number; learning: number; review: number }
export interface CardQueues {
  counts: Counts; main: QueueEntry[]; intraday: QueueEntry[];
  learnAheadSecs: number; currentDay: number; buildTime: number; cutoff: number;
}

export interface BuildInput {
  col: Collection; timing: SchedTimingToday; rootId: number;
  decks: Deck[];                 // all decks
  cfgs: Map<number, DeckConfig>;
  cards: Card[];                 // cards in root deck subtree
  now: Date;
}

// Deck order: root first then children by name (storage.child_decks + get_active_deck_ids_sorted).
export function activeDecks(decks: Deck[], rootId: number, applyAllParentLimits = false): Deck[] {
  const root = decks.find((d) => d.id === rootId);
  if (!root) return [];
  const children = decks.filter((d) => d.name.startsWith(root.name + '::')).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const out = [root, ...children];
  if (applyAllParentLimits) {
    const parents = decks.filter((d) => root.name.startsWith(d.name + '::')).sort((a, b) => a.name.length - b.name.length);
    out.unshift(...parents);
  }
  return out;
}

const dueIdx = (cards: Card[]) => cards;

function sortReviews(cards: Card[], order: ReviewOrder, deckPos: Map<number, number>, timing: SchedTimingToday, fsrs: boolean): Card[] {
  const rnd = (c: Card) => fnvhash(c.id, c.mod);
  const keys: ((a: Card, b: Card) => number)[] = [];
  const day = (a: Card, b: Card) => a.due - b.due;
  const deck = (a: Card, b: Card) => (deckPos.get(a.did) ?? 0) - (deckPos.get(b.did) ?? 0);
  switch (order) {
    case ReviewOrder.Day: keys.push(day); break;
    case ReviewOrder.DayThenDeck: keys.push(day, deck); break;
    case ReviewOrder.DeckThenDay: keys.push(deck, day); break;
    case ReviewOrder.IvlAsc: keys.push((a, b) => a.ivl - b.ivl); break;
    case ReviewOrder.IvlDesc: keys.push((a, b) => b.ivl - a.ivl); break;
    case ReviewOrder.EaseAsc: keys.push(fsrs ? (a, b) => (b.fsrs?.d ?? 0) - (a.fsrs?.d ?? 0) : (a, b) => a.factor - b.factor); break;
    case ReviewOrder.EaseDesc: keys.push(fsrs ? (a, b) => (a.fsrs?.d ?? 0) - (b.fsrs?.d ?? 0) : (a, b) => b.factor - a.factor); break;
    case ReviewOrder.RelativeOverdue: keys.push((a, b) => rel(b) - rel(a)); break; // -(1+overdue/ivl) asc
    case ReviewOrder.Added: keys.push((a, b) => a.nid - b.nid || a.ord - b.ord); break;
    case ReviewOrder.ReverseAdded: keys.push((a, b) => b.nid - a.nid || a.ord - b.ord); break;
    default: break; // Random, retrievability orders fall back to random
  }
  const rel = (c: Card) => 1 + (timing.daysElapsed - c.due + 0.001) / Math.max(1, c.ivl);
  keys.push((a, b) => cmpBig(rnd(a), rnd(b)));
  return [...cards].sort((a, b) => { for (const k of keys) { const r = k(a, b); if (r) return r; } return 0; });
}

function sortNewGather(cards: Card[], mode: 'lowest' | 'highest' | 'randomNotes' | 'randomCards', salt: number): Card[] {
  const c = [...cards];
  switch (mode) {
    case 'lowest': return c.sort((a, b) => a.due - b.due || a.ord - b.ord);
    case 'highest': return c.sort((a, b) => b.due - a.due || a.ord - b.ord);
    case 'randomNotes': return c.sort((a, b) => cmpBig(fnvhash(a.nid, salt), fnvhash(b.nid, salt)) || a.ord - b.ord);
    case 'randomCards': return c.sort((a, b) => cmpBig(fnvhash(a.id, salt), fnvhash(b.id, salt)));
  }
}

function sortNew(cards: Card[], order: NewSort, days: number): Card[] {
  const byId = (c: Card) => fnvhash(c.id, days), byNid = (c: Card) => fnvhash(c.nid, days);
  const c = [...cards];
  switch (order) {
    case NewSort.NoSort: return c;
    case NewSort.Template: return c.sort((a, b) => a.ord - b.ord);
    case NewSort.TemplateThenRandom: return c.sort((a, b) => a.ord - b.ord || cmpBig(byId(a), byId(b)));
    case NewSort.RandomNoteThenTemplate: return c.sort((a, b) => cmpBig(byNid(a), byNid(b)) || a.ord - b.ord);
    case NewSort.RandomCard: return c.sort((a, b) => cmpBig(byId(a), byId(b)));
  }
}

// intersperser.rs
function intersperse<T>(one: T[], two: T[]): T[] {
  const ratio = (one.length + 1) / (two.length + 1);
  const out: T[] = [];
  let i = 0, j = 0;
  while (i < one.length || j < two.length) {
    if (i >= one.length) out.push(two[j++]!);
    else if (j >= two.length) out.push(one[i++]!);
    else {
      const oneIdx = i + 1, twoIdx = Math.floor((j + 1) * ratio);
      if (oneIdx <= twoIdx) out.push(one[i++]!); else out.push(two[j++]!);
    }
  }
  return out;
}
const merge = <T,>(reviews: T[], other: T[], mode: ReviewMix, otherFirstWhenBefore = true): T[] =>
  mode === ReviewMix.After ? [...reviews, ...other] : mode === ReviewMix.Before ? (otherFirstWhenBefore ? [...other, ...reviews] : [...reviews, ...other]) : intersperse(reviews, other);

export const knuthSalt = (base: number) => Number((BigInt(base) * 2654435761n) & 0xffffffffn);

export function buildQueues(inp: BuildInput): CardQueues {
  const { col, timing, cfgs } = inp;
  const decks = activeDecks(inp.decks, inp.rootId, col.applyAllParentLimits);
  const active = new Set(activeDecks(inp.decks, inp.rootId).map((d) => d.id));
  const deckPos = new Map(decks.map((d, i) => [d.id, i]));
  const root = decks.find((d) => d.id === inp.rootId)!;
  const cfg = cfgs.get(root.confId);
  const limits = new LimitTree(decks, cfgs, timing.daysElapsed, col.newCardsIgnoreReviewLimit);
  const seen = new Map<number, BuryMode>();
  const deckById = new Map(inp.decks.map((d) => [d.id, d]));
  const buryModeFor = (c: Card) => buryModeOf(cfgs.get(deckById.get(c.odid || c.did)?.confId ?? -1));
  // returns previous mode for the note (undefined on first sight)
  const seeNote = (c: Card): BuryMode | undefined => {
    const mode = buryModeFor(c), prev = seen.get(c.nid);
    if (prev) seen.set(c.nid, { buryNew: prev.buryNew || mode.buryNew, buryReviews: prev.buryReviews || mode.buryReviews, buryInterdayLearning: prev.buryInterdayLearning || mode.buryInterdayLearning });
    else seen.set(c.nid, mode);
    return prev;
  };

  const cards = inp.cards.filter((c) => active.has(c.did));
  const learning: Card[] = [], dayLearning: Card[] = [], review: Card[] = [], fresh: Card[] = [];

  // intraday learning: queue 1/4, due <= next_day_at
  for (const c of cards.filter((c) => (c.queue === Queue.Learn || c.queue === Queue.Preview) && c.due <= timing.nextDayAt)) { seeNote(c); learning.push(c); }

  const gatherDue = (queue: Queue) => {
    if (limits.rootReached('review')) return;
    const sorted = sortReviews(cards.filter((c) => c.queue === queue && c.due <= timing.daysElapsed), cfg?.reviewOrder ?? ReviewOrder.Day, deckPos, timing, col.fsrs);
    for (const c of sorted) {
      if (limits.rootReached('review')) break;
      if (limits.reached(c.did, 'review')) continue;
      const prev = seeNote(c);
      const bury = prev ? (queue === Queue.Review ? prev.buryReviews : prev.buryInterdayLearning) : false;
      if (bury) continue;
      (queue === Queue.Review ? review : dayLearning).push(c);
      limits.decrement(c.did, 'review');
    }
  };
  gatherDue(Queue.DayLearn);
  gatherDue(Queue.Review);

  const salt = knuthSalt(timing.daysElapsed);
  const addNew = (c: Card) => { const prev = seeNote(c); if (prev?.buryNew) return false; fresh.push(c); return true; };
  const gatherSorted = (mode: 'lowest' | 'highest' | 'randomNotes' | 'randomCards') => {
    for (const c of sortNewGather(cards.filter((c) => c.queue === Queue.New), mode, salt)) {
      if (limits.rootReached('new')) break;
      if (!limits.reached(c.did, 'new') && addNew(c)) limits.decrement(c.did, 'new');
    }
  };
  const gatherByDeck = (mode: 'lowest' | 'randomNotes') => {
    for (const d of decks) {
      if (!active.has(d.id)) continue;
      if (limits.rootReached('new')) break;
      if (limits.reached(d.id, 'new')) continue;
      for (const c of sortNewGather(cards.filter((c) => c.queue === Queue.New && c.did === d.id), mode, salt)) {
        if (limits.reached(d.id, 'new')) break;
        if (addNew(c)) limits.decrement(d.id, 'new');
      }
    }
  };
  switch (cfg?.newGather ?? NewGather.Deck) {
    case NewGather.Deck: gatherByDeck('lowest'); break;
    case NewGather.DeckThenRandomNotes: gatherByDeck('randomNotes'); break;
    case NewGather.LowestPosition: gatherSorted('lowest'); break;
    case NewGather.HighestPosition: gatherSorted('highest'); break;
    case NewGather.RandomNotes: gatherSorted('randomNotes'); break;
    case NewGather.RandomCards: gatherSorted('randomCards'); break;
  }

  const newSorted = sortNew(fresh, cfg?.newSort ?? NewSort.Template, timing.daysElapsed);
  const entry = (c: Card, kind: EntryKind): QueueEntry => ({ id: c.id, kind, due: c.due, reps: c.reps });
  const intraday = learning.map((c) => entry(c, 'learning')).sort(cmpRepsThenDue);
  const now = Math.floor(inp.now.getTime() / 1000);
  const cutoff = now + col.learnAheadSecs;
  const withDayLearn = merge(review.map((c) => entry(c, 'review')), dayLearning.map((c) => entry(c, 'learning')), cfg?.interdayMix ?? ReviewMix.Mix);
  const main = merge(withDayLearn, newSorted.map((c) => entry(c, 'new')), cfg?.newMix ?? ReviewMix.Mix);
  return {
    counts: { new: newSorted.length, review: review.length, learning: intraday.filter((e) => e.due <= cutoff).length + dayLearning.length },
    main, intraday, learnAheadSecs: col.learnAheadSecs, currentDay: timing.daysElapsed, buildTime: Date.now(), cutoff: now,
  };
}

export const cmpRepsThenDue = (a: QueueEntry, b: QueueEntry) => Number(a.reps === 0) - Number(b.reps === 0) || a.due - b.due;

// queue/mod.rs iter(): intraday due now, then main, then intraday within learn-ahead.
export function nextEntry(q: CardQueues, nowSecs: number): QueueEntry | undefined {
  q.cutoff = nowSecs;
  const ahead = nowSecs + q.learnAheadSecs;
  return q.intraday.find((e) => e.due <= nowSecs) ?? q.main[0] ?? q.intraday.find((e) => e.due > nowSecs && e.due <= ahead);
}

export function popEntry(q: CardQueues, id: number) {
  const i = q.intraday.findIndex((e) => e.id === id);
  if (i >= 0) { q.intraday.splice(i, 1); q.counts.learning = Math.max(0, q.counts.learning - 1); return; }
  if (q.main[0]?.id === id) {
    const e = q.main.shift()!;
    if (e.kind === 'new') q.counts.new--; else if (e.kind === 'review') q.counts.review--; else q.counts.learning = Math.max(0, q.counts.learning - 1);
  }
}

// learning.rs requeue: after answering, an intraday learning card goes back into the queue.
export function requeueLearning(q: CardQueues, card: Card, timing: SchedTimingToday, nowSecs: number) {
  if (card.queue !== Queue.Learn || card.due >= timing.nextDayAt) return;
  const e: QueueEntry = { id: card.id, kind: 'learning', due: card.due, reps: card.reps };
  const ahead = nowSecs + q.learnAheadSecs;
  if (e.due <= ahead && q.main.length === 0) {
    const next = q.intraday[0];
    if (next && next.due >= e.due && next.due + 1 < ahead) e.due = next.due + 1;
  }
  if (e.due <= ahead) q.counts.learning++;
  let idx = q.intraday.findIndex((x) => cmpRepsThenDue(x, e) > 0);
  if (idx < 0) idx = q.intraday.length;
  q.intraday.splice(idx, 0, e);
}

export const isLearnCard = (c: Card) => c.type === CardType.Learn || c.type === CardType.Relearn;
void dueIdx;
