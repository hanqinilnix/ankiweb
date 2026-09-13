// Ported from rslib/src/scheduler/states/{steps,fuzz,learning,review}.rs tests, plus answering checks.
import { describe, expect, it } from 'vitest';
import { CardType, LeechAction, Queue, Rating, RevlogType, type Card, type Collection, type DeckConfig, emptyCommon, emptyNormal, type Deck } from '../src/model/types';
import { answerCard, describeNextStates, makeUpdater } from '../src/scheduler/answering';
import { constrainedFuzzBounds, LearningSteps, leechThresholdMet, minimumReviewFuzzInterval, nextStates, passingReviewIntervals, withReviewFuzz, type ReviewState, type StateContext } from '../src/scheduler/states';
import { schedTimingToday } from '../src/scheduler/timing';
const timingAt = (col: Collection, d: Date) => schedTimingToday(col.crt, Math.floor(d.getTime() / 1000), 0, 0, 4);
import { Fsrs } from '../src/scheduler/fsrs';

const defaults = (): StateContext => ({
  fuzzFactor: undefined, steps: new LearningSteps([1, 10]), relearnSteps: new LearningSteps([10]),
  graduatingIntervalGood: 1, graduatingIntervalEasy: 4, initialEaseFactor: 2.5, hardMultiplier: 1.2, easyMultiplier: 1.3,
  intervalMultiplier: 1, maximumReviewInterval: 36500, leechThreshold: 8, lapseMultiplier: 0, minimumLapseInterval: 1,
  fsrsShortTermWithStepsEnabled: false, fsrsAllowShortTerm: false,
});
const DAY = 86400;

describe('steps', () => {
  const chk = (steps: number[], rem: number, again?: number, hard?: number, good?: number) => {
    const s = new LearningSteps(steps);
    expect([s.againDelaySecsLearn(), s.hardDelaySecs(rem), s.goodDelaySecs(rem)]).toEqual([again, hard, good]);
  };
  it('delay_secs', () => {
    chk([10], 1, 600, 900, undefined);
    chk([(3 * DAY) / 60], 1, 3 * DAY, 4 * DAY, undefined);
    chk([1, 10], 2, 60, 330, 600);
    chk([1, 10], 1, 60, 600, undefined);
    chk([1, 10, 100], 3, 60, 330, 600);
    chk([1, 10, 100], 2, 60, 600, 6000);
    chk([1, 10, 100], 1, 60, 6000, undefined);
  });
});

describe('fuzz', () => {
  it('with_review_fuzz', () => {
    const ctx = defaults();
    const f = (ivl: number, min: number, max: number) => withReviewFuzz(ctx.fuzzFactor, ivl, min, max);
    expect([f(1.5, 1, 100), f(0.1, 1, 100), f(101, 1, 100)]).toEqual([2, 1, 100]);
    const lmu = (ivl: number, min: number, max: number, lo: number, mid: number, hi: number) => {
      expect(withReviewFuzz(0, ivl, min, max)).toBe(lo); expect(withReviewFuzz(0.5, ivl, min, max)).toBe(mid); expect(withReviewFuzz(0.99, ivl, min, max)).toBe(hi);
    };
    lmu(1, 1, 1000, 1, 1, 1); lmu(2.49, 1, 1000, 2, 2, 2);
    lmu(2.5, 1, 1000, 2, 3, 4); lmu(7, 1, 1000, 5, 7, 9); lmu(17, 1, 1000, 14, 17, 20); lmu(37, 1, 1000, 33, 37, 41);
    lmu(2, 2, 1000, 2, 2, 2); lmu(2, 3, 1000, 3, 4, 4); lmu(2, 3, 3, 3, 3, 3);
    lmu(6.9, 3, 1000, 5, 7, 9); lmu(7, 3, 1000, 5, 7, 9); lmu(7.1, 3, 1000, 5, 7, 9);
    lmu(19.9, 3, 1000, 17, 20, 23); lmu(20, 3, 1000, 17, 20, 23); lmu(20.1, 3, 1000, 17, 20, 23);
    lmu(100, 101, 1000, 101, 105, 108); lmu(100, 1, 99, 92, 96, 99); lmu(100, 97, 103, 97, 100, 103);
  });
  it('invalid values do not throw', () => { constrainedFuzzBounds(1, 3, 2); });
  it('minimum_review_fuzz_interval', () => {
    expect(minimumReviewFuzzInterval(2.7269483, 4, 36500)).toBe(4);
    expect(minimumReviewFuzzInterval(2.7269483, 5, 36500)).toBe(0);
    expect(minimumReviewFuzzInterval(4.591988, 4, 36500)).toBe(5);
  });
});

describe('learning', () => {
  const learn = (remainingSteps: number) => ({ kind: 'learning' as const, remainingSteps, scheduledSecs: 60, elapsedSecs: 0 });
  it('again resets to first step', () => {
    for (const r of [1, 2]) expect(nextStates(learn(r), defaults()).again).toMatchObject({ kind: 'learning', remainingSteps: 2, scheduledSecs: 60 });
  });
  it('again with no steps graduates', () => {
    expect(nextStates(learn(0), { ...defaults(), steps: new LearningSteps([]) }).again).toMatchObject({ kind: 'review', scheduledDays: 1 });
  });
  it('hard stays on step', () => {
    expect(nextStates(learn(2), defaults()).hard).toMatchObject({ kind: 'learning', remainingSteps: 2, scheduledSecs: 330 });
    expect(nextStates(learn(1), defaults()).hard).toMatchObject({ kind: 'learning', remainingSteps: 1, scheduledSecs: 600 });
  });
  it('good advances then graduates', () => {
    expect(nextStates(learn(2), defaults()).good).toMatchObject({ kind: 'learning', remainingSteps: 1, scheduledSecs: 600 });
    expect(nextStates(learn(1), defaults()).good).toMatchObject({ kind: 'review', scheduledDays: 1 });
    expect(nextStates(learn(1), defaults()).easy).toMatchObject({ kind: 'review', scheduledDays: 4 });
  });
  it('new card goes through learning', () => {
    const s = nextStates({ kind: 'new', position: 0 }, defaults());
    expect(s.again).toMatchObject({ remainingSteps: 2, scheduledSecs: 60 });
    expect(s.hard).toMatchObject({ remainingSteps: 2, scheduledSecs: 330 });
    expect(s.good).toMatchObject({ remainingSteps: 1, scheduledSecs: 600 });
    expect(s.easy).toMatchObject({ kind: 'review', scheduledDays: 4, easeFactor: 2.5 });
  });
});

describe('review', () => {
  const st = (o: Partial<ReviewState>): ReviewState => ({ kind: 'review', scheduledDays: 1, elapsedDays: 1, easeFactor: 1.3, lapses: 0, leeched: false, ...o });
  it('leech_threshold', () => {
    const t = (l: number, th: number) => leechThresholdMet(l, th);
    expect([t(0, 3), t(1, 3), t(2, 3), t(3, 3), t(4, 3), t(5, 3), t(6, 3), t(7, 3)]).toEqual([false, false, false, true, false, true, false, true]);
    expect([t(7, 8), t(8, 8), t(9, 8), t(10, 8), t(11, 8), t(12, 8), t(13, 8)]).toEqual([false, true, false, false, false, true, false]);
    expect(t(0, 0)).toBe(false);
    expect([t(0, 1), t(1, 1), t(2, 1), t(3, 1)]).toEqual([false, true, true, true]);
  });
  it('extreme_multiplier_fuzz', () => {
    const ctx = defaults();
    const s = st({});
    ctx.fuzzFactor = 0;
    expect(passingReviewIntervals(s, ctx)).toEqual([2, 3, 4]);
    ctx.intervalMultiplier = 0.1;
    expect(passingReviewIntervals(s, ctx)).toEqual([2, 3, 4]);
    ctx.fuzzFactor = 0.99;
    expect(passingReviewIntervals(s, ctx)).toEqual([2, 4, 6]);
    ctx.intervalMultiplier = 10; ctx.maximumReviewInterval = 5;
    expect(passingReviewIntervals(s, ctx)).toEqual([5, 5, 5]);
  });
  it('low_hard_multiplier_does_not_pull_good_down', () => {
    const ctx = { ...defaults(), hardMultiplier: 0.1, fuzzFactor: 0 };
    expect(passingReviewIntervals(st({ scheduledDays: 2, elapsedDays: 2 }), ctx)).toEqual([1, 3, 4]);
  });
  it('standard intervals', () => {
    const s = st({ scheduledDays: 5, elapsedDays: 5, easeFactor: 2.5 });
    const n = nextStates(s, defaults());
    expect(n.hard).toMatchObject({ scheduledDays: 6, easeFactor: 2.35 });
    expect(n.good).toMatchObject({ scheduledDays: 13, easeFactor: 2.5 });
    expect(n.easy).toMatchObject({ scheduledDays: 16, easeFactor: 2.65 });
    expect(n.again).toMatchObject({ kind: 'relearning', learning: { remainingSteps: 1, scheduledSecs: 600 }, review: { scheduledDays: 1, lapses: 1, easeFactor: 2.3 } });
  });
  it('early review uses elapsed days', () => {
    const n = nextStates(st({ scheduledDays: 5, elapsedDays: 1, easeFactor: 2.5 }), defaults());
    expect(n.good).toMatchObject({ scheduledDays: 5 });
  });
});

describe('answering', () => {
  const col: Collection = { crt: 1_700_000_000, rollover: 4, fsrs: false, creationOffset: 0, learnAheadSecs: 1200, newCardsIgnoreReviewLimit: false, applyAllParentLimits: false, lastUnburiedDay: 0 };
  const cfg: DeckConfig = {
    id: 1, name: 'd', newPerDay: 20, revPerDay: 200, learnSteps: [1, 10], relearnSteps: [10], graduatingIvl: 1, easyIvl: 4, startEase: 2.5, maxIvl: 36500,
    hardMult: 1.2, easyMult: 1.3, lapseMult: 0, ivlMult: 1, minLapseIvl: 1, leechThreshold: 8, leechAction: LeechAction.Suspend, capAnswerSecs: 60,
    buryNew: false, buryReviews: false, buryInterdayLearning: false, newGather: 0, newSort: 0, reviewOrder: 0, newMix: 0, interdayMix: 0, fsrs: false, fsrsParams: [], desiredRetention: 0.9,
  };
  const deck: Deck = { id: 1, name: 'd', confId: 1, common: emptyCommon(), normal: emptyNormal() };
  const now = new Date((col.crt + 10 * DAY + 3600) * 1000);
  const base: Card = { id: 1, nid: 1, did: 1, ord: 0, mod: 0, type: CardType.New, queue: Queue.New, due: 0, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, odue: 0, odid: 0, flags: 0 };
  const review: Card = { ...base, type: CardType.Review, queue: Queue.Review, due: 10, ivl: 5, factor: 2500, reps: 3 };
  const up = (c: Card, cl = col, cf = cfg) => makeUpdater(c, deck, cf, cl, timingAt(cl, now), now, undefined, { fuzz: false });

  it('today is 10', () => { expect(timingAt(col, now).daysElapsed).toBe(10); });
  it('new card good/easy', () => {
    const g = answerCard(up(base), Rating.Good, now.getTime(), 1000);
    expect(g.card).toMatchObject({ type: CardType.Learn, queue: Queue.Learn, left: 1, reps: 1, factor: 0 });
    expect(g.card.due - now.getTime() / 1000).toBeCloseTo(600, 0);
    expect(g.revlog).toMatchObject({ ease: 3, ivl: -600, lastIvl: 0, type: RevlogType.Learn, time: 1000 });
    expect(g.newDelta).toBe(1);
    const e = answerCard(up(base), Rating.Easy, now.getTime(), 0);
    expect(e.card).toMatchObject({ type: CardType.Review, queue: Queue.Review, ivl: 4, due: 14, factor: 2500 });
  });
  it('review good/again', () => {
    const g = answerCard(up(review), Rating.Good, now.getTime(), 0);
    expect(g.card).toMatchObject({ ivl: 13, due: 23, factor: 2500, reps: 4 });
    expect(g.revlog).toMatchObject({ ivl: 13, lastIvl: 5, factor: 2500, type: RevlogType.Review });
    expect(g.reviewDelta).toBe(1);
    const a = answerCard(up(review), Rating.Again, now.getTime(), 0);
    expect(a.card).toMatchObject({ type: CardType.Relearn, queue: Queue.Learn, lapses: 1, factor: 2300, ivl: 1, left: 1 });
    expect(a.revlog.ivl).toBe(-600);
  });
  it('leech suspends', () => {
    const a = answerCard(up({ ...review, lapses: 7 }), Rating.Again, now.getTime(), 0);
    expect(a.leeched).toBe(true); expect(a.card.queue).toBe(Queue.Suspended);
  });
  it('button labels', () => {
    expect(describeNextStates(up(base), 1200)).toEqual({ 1: '<1m', 2: '<6m', 3: '<10m', 4: '4d' });
    expect(describeNextStates(up(review), 1200)).toEqual({ 1: '<10m', 2: '6d', 3: '13d', 4: '16d' });
  });
  it('learning step crossing rollover becomes days', () => {
    const late = new Date((col.crt + 10 * DAY + 20800 - 300) * 1000); // 5 min before the 04:00 UTC rollover
    const u = makeUpdater(base, deck, cfg, col, timingAt(col, late), late, undefined, { fuzz: false });
    expect(describeNextStates(u, 1200)[Rating.Good]).toBe('1d');
    const r = answerCard(u, Rating.Good, late.getTime(), 0);
    expect(r.card.queue).toBe(Queue.DayLearn);
  });
  it('fsrs path', () => {
    const fcol = { ...col, fsrs: true }, fcfg = { ...cfg, fsrsParams: [] };
    const g = answerCard(up(base, fcol, fcfg), Rating.Good, now.getTime(), 0);
    expect(g.card.type).toBe(CardType.Learn); expect(g.card.fsrs!.s).toBeCloseTo(2.3065, 3);
    const r = answerCard(up({ ...review, fsrs: { s: 5, d: 5 } }, fcol, fcfg), Rating.Good, now.getTime(), 0);
    expect(r.card.type).toBe(CardType.Review); expect(r.card.ivl).toBeGreaterThan(5); expect(r.card.due).toBe(10 + r.card.ivl);
    expect(r.revlog.factor).toBe(Math.round(r.card.fsrs!.d * 1000));
    const a = answerCard(up({ ...review, fsrs: { s: 5, d: 5 } }, fcol, fcfg), Rating.Again, now.getTime(), 0);
    expect(a.card.type).toBe(CardType.Relearn);
    // sm2 fallback for cards without memory state
    const noMem = answerCard(up(review, fcol, fcfg), Rating.Good, now.getTime(), 0);
    expect(noMem.card.fsrs).toBeDefined();
  });
  it('fsrs engine basics', () => {
    const f = new Fsrs([]);
    expect(f.w).toHaveLength(21);
    expect(new Fsrs(Array(17).fill(0.5)).w).toHaveLength(21);
    const n = f.nextStates(undefined, 0.9, 0);
    expect(n.good.memory.stability).toBeCloseTo(2.3065, 3);
    expect(n.good.interval).toBeCloseTo(2.3065, 2); // dr=0.9 -> interval == stability
    expect(n.again.interval).toBeLessThan(n.hard.interval); expect(n.hard.interval).toBeLessThan(n.good.interval); expect(n.good.interval).toBeLessThan(n.easy.interval);
    const m = f.memoryStateFromSm2(2.5, 10, 0.9)!;
    expect(m.stability).toBeCloseTo(10, 5);
  });
});
