// Ported from rslib/src/scheduler/queue/builder/mod.rs tests and decks/limits.rs behaviour.
import { describe, expect, it } from 'vitest';
import { CardType, emptyCommon, emptyNormal, LeechAction, NewGather, NewSort, Queue, ReviewMix, ReviewOrder, type Card, type Collection, type Deck, type DeckConfig } from '../src/model/types';
import { fnvhash } from '../src/scheduler/fnv';
import { LimitTree, remainingLimits } from '../src/scheduler/limits';
import { buildQueues, knuthSalt, nextEntry } from '../src/scheduler/queue';
import { schedTimingToday } from '../src/scheduler/timing';

const col: Collection = { crt: 1_700_000_000, rollover: 4, fsrs: false, creationOffset: 0, learnAheadSecs: 1200, newCardsIgnoreReviewLimit: false, applyAllParentLimits: false, lastUnburiedDay: 0 };
const now = new Date((col.crt + 10 * 86400 + 3600) * 1000);
const timing = schedTimingToday(col.crt, Math.floor(now.getTime() / 1000), 0, 0, 4);
const cfg = (id: number, o: Partial<DeckConfig> = {}): DeckConfig => ({
  id, name: 'c', newPerDay: 20, revPerDay: 200, learnSteps: [1, 10], relearnSteps: [10], graduatingIvl: 1, easyIvl: 4, startEase: 2.5, maxIvl: 36500,
  hardMult: 1.2, easyMult: 1.3, lapseMult: 0, ivlMult: 1, minLapseIvl: 1, leechThreshold: 8, leechAction: LeechAction.TagOnly, capAnswerSecs: 60,
  buryNew: false, buryReviews: false, buryInterdayLearning: false, newGather: NewGather.Deck, newSort: NewSort.NoSort, reviewOrder: ReviewOrder.Day, newMix: ReviewMix.Mix, interdayMix: ReviewMix.Mix,
  fsrs: false, fsrsParams: [], desiredRetention: 0.9, ...o,
});
const deck = (id: number, name: string, confId = 1): Deck => ({ id, name, confId, common: emptyCommon(), normal: emptyNormal() });
let nextId = 1;
const card = (did: number, o: Partial<Card> = {}): Card => ({ id: nextId++, nid: nextId, did, ord: 0, mod: 0, type: CardType.New, queue: Queue.New, due: nextId, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, odue: 0, odid: 0, flags: 0, ...o });

it('fnvhash matches Rust fnv Hasher::write_i64', () => {
  const ref = (bytes: number[]) => bytes.reduce((h, b) => ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn, 0xcbf29ce484222325n);
  expect(fnvhash(0x61)).toBe(ref([0x61, 0, 0, 0, 0, 0, 0, 0]));
  expect(fnvhash(-1)).toBe(ref([255, 255, 255, 255, 255, 255, 255, 255]));
  expect(fnvhash(5, 7)).toBe(ref([5, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0]));
  expect(knuthSalt(1)).toBe(2654435761);
});

describe('limits', () => {
  it('remaining_limits subtracts studied and caps new to review', () => {
    const d = deck(1, 'a'); d.common = { ...emptyCommon(), lastDayStudied: 10, newStudied: 5, reviewStudied: 20 };
    expect(remainingLimits(d, cfg(1, { newPerDay: 10, revPerDay: 30 }), 10, false)).toEqual({ review: 5, new: 5, capNewToReview: true });
    expect(remainingLimits(d, cfg(1, { newPerDay: 10, revPerDay: 30 }), 10, true)).toEqual({ review: 10, new: 5, capNewToReview: false });
    expect(remainingLimits(d, cfg(1, { newPerDay: 10, revPerDay: 30 }), 11, false)).toEqual({ review: 30, new: 10, capNewToReview: true });
    d.normal = { ...emptyNormal(), newLimitToday: { limit: 50, today: 10 } };
    expect(remainingLimits(d, cfg(1, { newPerDay: 10, revPerDay: 100 }), 10, true).new).toBe(45);
  });
  it('tree caps children to parents and decrements up the chain', () => {
    const decks = [deck(1, 'p'), deck(2, 'p::c', 2), deck(3, 'p::c::g')];
    const t = new LimitTree(decks, new Map([[1, cfg(1, { newPerDay: 3 })], [2, cfg(2, { newPerDay: 10 })]]), 10, false);
    expect(t.get(2).new).toBe(3); expect(t.get(3).new).toBe(3);
    t.decrement(3, 'new'); t.decrement(3, 'new'); t.decrement(3, 'new');
    expect(t.rootReached('new')).toBe(true); expect(t.reached(2, 'new')).toBe(true);
  });
});

describe('queue building', () => {
  const decks = [deck(1, 'parent'), deck(2, 'parent::child', 2), deck(3, 'parent::child_2'), deck(4, 'parent::child::grandchild')];
  const cards: Card[] = [];
  for (const d of decks) { const nid = nextId++; cards.push(card(d.id, { nid, ord: 0, due: nid }), card(d.id, { nid, ord: 1, due: nid })); }
  const build = (gather: NewGather) => {
    const cfgs = new Map([[1, cfg(1, { newGather: gather })], [2, cfg(2, { newPerDay: 3 })]]);
    return buildQueues({ col, timing, rootId: 1, decks, cfgs, cards, now }).main.map((e) => { const c = cards.find((x) => x.id === e.id)!; return [c.did, c.ord]; });
  };
  it('new_queue_building', () => {
    expect(build(NewGather.Deck)).toEqual([[1, 0], [1, 1], [2, 0], [2, 1], [4, 0], [3, 0], [3, 1]]);
    expect(build(NewGather.LowestPosition)).toEqual([[1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0]]);
    expect(build(NewGather.HighestPosition)).toEqual([[4, 0], [4, 1], [3, 0], [3, 1], [2, 0], [1, 0], [1, 1]]);
  });
  it('empty queue when review limit reached', () => {
    const rc = [card(1, { type: CardType.Review, queue: Queue.Review, due: 5, ivl: 3 })];
    const q = buildQueues({ col, timing, rootId: 1, decks: [deck(1, 'parent')], cfgs: new Map([[1, cfg(1, { revPerDay: 0 })]]), cards: rc, now });
    expect(q.main).toEqual([]);
    const q2 = buildQueues({ col, timing, rootId: 1, decks: [deck(1, 'parent')], cfgs: new Map([[1, cfg(1)]]), cards: rc, now });
    expect(q2.counts).toEqual({ new: 0, review: 1, learning: 0 });
  });
  it('sibling burying and learning order', () => {
    const nid = nextId++;
    const cs = [card(1, { nid, ord: 0 }), card(1, { nid, ord: 1 }), card(1, { type: CardType.Learn, queue: Queue.Learn, due: timing.now + 100, reps: 1 }), card(1, { type: CardType.Learn, queue: Queue.Learn, due: timing.now - 100, reps: 1 })];
    const q = buildQueues({ col, timing, rootId: 1, decks: [deck(1, 'parent')], cfgs: new Map([[1, cfg(1, { buryNew: true })]]), cards: cs, now });
    expect(q.counts).toEqual({ new: 1, review: 0, learning: 2 });
    expect(nextEntry(q, timing.now)!.id).toBe(cs[3]!.id); // due learning card first
    expect(q.intraday.map((e) => e.id)).toEqual([cs[3]!.id, cs[2]!.id]);
  });
});
