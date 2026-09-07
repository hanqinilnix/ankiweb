import { describe, expect, it } from 'vitest';
import { CardType, Queue, Rating, type Card, type Collection, type DeckConfig } from '../src/model/types';
import { makeSm2, sm2 as fuzzed } from '../src/scheduler/sm2';
const sm2 = makeSm2({ fuzz: false });
import { fsrs } from '../src/scheduler/fsrs';
import { isDue, pick, today } from '../src/scheduler';

const col: Collection = { crt: 1_700_000_000, rollover: 4, fsrs: false };
const now = new Date((col.crt + 10 * 86400 + 3600) * 1000); // day 10
const cfg: DeckConfig = {
  id: 1, name: 'd', newPerDay: 20, revPerDay: 200, learnSteps: [1, 10], relearnSteps: [10],
  graduatingIvl: 1, easyIvl: 4, startEase: 2.5, maxIvl: 36500, hardMult: 1.2, easyMult: 1.3, lapseMult: 0, ivlMult: 1, minLapseIvl: 1, leechThreshold: 8, fsrs: false, fsrsParams: [], desiredRetention: 0.9,
};
const base: Card = { id: 1, nid: 1, did: 1, ord: 0, type: CardType.New, queue: Queue.New, due: 0, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, odue: 0, odid: 0, flags: 0 };
const review: Card = { ...base, type: CardType.Review, queue: Queue.Review, due: 10, ivl: 5, factor: 2500, reps: 3 };

it('today / isDue', () => {
  expect(today(col, now)).toBe(10);
  expect(isDue(review, col, now)).toBe(true);
  expect(isDue({ ...review, due: 11 }, col, now)).toBe(false);
  expect(isDue({ ...base, queue: Queue.Suspended }, col, now)).toBe(false);
});

describe('sm2', () => {
  it.each([
    [Rating.Again, Queue.Learn, 60, 2],
    [Rating.Hard, Queue.Learn, 330, 2],
    [Rating.Good, Queue.Learn, 600, 1],
  ])('new card rating %i', (r, queue, secs, left) => {
    const { card } = sm2.answer(base, r, cfg, col, now, 1000);
    expect(card.queue).toBe(queue);
    expect(card.due - now.getTime() / 1000).toBeCloseTo(secs, 0);
    expect(card.left).toBe(left);
    expect(card.factor).toBe(2500);
  });
  it('new card easy graduates', () => {
    const { card, revlog } = sm2.answer(base, Rating.Easy, cfg, col, now, 1000);
    expect([card.type, card.queue, card.ivl, card.due]).toEqual([CardType.Review, Queue.Review, 4, 14]);
    expect(revlog.type).toBe(0);
    expect(revlog.ease).toBe(Rating.Easy);
  });
  it('last learn step good graduates', () => {
    const learn = { ...base, type: CardType.Learn, queue: Queue.Learn, left: 1, factor: 2500 };
    const { card } = sm2.answer(learn, Rating.Good, cfg, col, now, 0);
    expect([card.type, card.ivl, card.due]).toEqual([CardType.Review, 1, 11]);
  });
  it.each([
    [Rating.Hard, 6, 2350],
    [Rating.Good, 13, 2500],
    [Rating.Easy, 16, 2650],
  ])('review rating %i', (r, ivl, factor) => {
    const { card } = sm2.answer(review, r, cfg, col, now, 0);
    expect([card.ivl, card.due, card.factor]).toEqual([ivl, 10 + ivl, factor]);
  });
  it('review again lapses', () => {
    const { card, revlog } = sm2.answer(review, Rating.Again, cfg, col, now, 0);
    expect([card.type, card.queue, card.lapses, card.factor, card.ivl]).toEqual([CardType.Relearn, Queue.Learn, 1, 2300, 1]);
    expect(revlog.type).toBe(1);
  });
  it('fuzz stays within bounds and is deterministic', () => {
    const big = { ...review, ivl: 30, due: 10 };
    const a = fuzzed.answer(big, Rating.Good, cfg, col, now, 0).card.ivl;
    expect(a).toBe(fuzzed.answer(big, Rating.Good, cfg, col, now, 0).card.ivl);
    expect(a).toBeGreaterThanOrEqual(69); expect(a).toBeLessThanOrEqual(81); // 75 +- fuzz delta 5.7
  });
  it('early review uses elapsed days', () => {
    const early = { ...review, due: 14 }; // 4 days early, elapsed 1
    const { card } = sm2.answer(early, Rating.Good, cfg, col, now, 0);
    expect(card.ivl).toBe(5);
  });
  it('leech flag at threshold', () => {
    let c = { ...review, lapses: 7 };
    c = sm2.answer(c, Rating.Again, cfg, col, now, 0).card;
    expect(c.lapses).toBe(8); expect(c.flags & 0x80).toBeTruthy();
  });
  it('preview strings', () => {
    expect(sm2.preview(base, cfg, col, now)).toEqual({ 1: '1m', 2: '6m', 3: '10m', 4: '4d' });
    expect(sm2.preview(review, cfg, col, now)[Rating.Good]).toBe('13d');
  });
});

describe('fsrs', () => {
  const fcfg = { ...cfg, fsrsParams: [0.4, 0.9, 2.3, 10.9, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61] };
  const fcol = { ...col, fsrs: true };
  it('picked when enabled', () => {
    expect(pick(fcfg, fcol)).toBe(fsrs);
    expect(pick(cfg, fcol)).toBe(fuzzed);
  });
  it('new card good enters learning with memory state', () => {
    const { card } = fsrs.answer(base, Rating.Good, fcfg, fcol, now, 0);
    expect(card.type).toBe(CardType.Learn);
    expect(card.fsrs!.s).toBeGreaterThan(0);
    expect(card.fsrs!.d).toBeGreaterThan(0);
  });
  it('review good extends interval', () => {
    const r = { ...review, fsrs: { s: 5, d: 5 } };
    const { card } = fsrs.answer(r, Rating.Good, fcfg, fcol, now, 0);
    expect(card.type).toBe(CardType.Review);
    expect(card.ivl).toBeGreaterThan(5);
    expect(card.due).toBe(10 + card.ivl);
    const again = fsrs.answer(r, Rating.Again, fcfg, fcol, now, 0).card;
    expect(again.type).toBe(CardType.Relearn);
    expect(again.lapses).toBe(1);
  });
  it('preview ordered', () => {
    const p = fsrs.preview({ ...review, fsrs: { s: 5, d: 5 } }, fcfg, fcol, now);
    expect(Object.keys(p)).toEqual(['1', '2', '3', '4']);
  });
});
