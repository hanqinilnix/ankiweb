// Port of rslib/src/scheduler/states/{mod,new,learning,review,relearning,steps,fuzz,interval_kind}.rs
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import { Rating, RevlogType } from '../model/types';
import type { MemoryState, NextStates } from './fsrs';

const DAY = 86400;
export const INITIAL_EASE = 2.5, MIN_EASE = 1.3, EASE_AGAIN = -0.2, EASE_HARD = -0.15, EASE_EASY = 0.15;

// ---- states ----
export interface NewState { kind: 'new'; position: number }
export interface LearnState { kind: 'learning'; remainingSteps: number; scheduledSecs: number; elapsedSecs: number; memory?: MemoryState }
export interface ReviewState { kind: 'review'; scheduledDays: number; elapsedDays: number; easeFactor: number; lapses: number; leeched: boolean; memory?: MemoryState }
export interface RelearnState { kind: 'relearning'; learning: Omit<LearnState, 'kind'>; review: Omit<ReviewState, 'kind'> }
export type CardState = NewState | LearnState | ReviewState | RelearnState;
export interface SchedulingStates { current: CardState; again: CardState; hard: CardState; good: CardState; easy: CardState }

export type IntervalKind = { secs: number } | { days: number };
export const maybeAsDays = (k: IntervalKind, secsUntilRollover: number): IntervalKind =>
  'secs' in k && k.secs >= secsUntilRollover ? { days: Math.floor((k.secs - secsUntilRollover) / DAY) + 1 } : k;
export const asSeconds = (k: IntervalKind) => ('secs' in k ? k.secs : k.days * DAY);
export const asRevlogInterval = (k: IntervalKind) => ('days' in k ? k.days : -k.secs || 0);

export function intervalKind(s: CardState): IntervalKind {
  switch (s.kind) {
    case 'new': return { secs: 0 };
    case 'learning': return { secs: s.scheduledSecs };
    case 'review': return { days: s.scheduledDays };
    case 'relearning': return { secs: s.learning.scheduledSecs };
  }
}
export const daysLate = (s: Omit<ReviewState, 'kind'>) => s.elapsedDays - s.scheduledDays;
export function revlogKind(s: CardState): RevlogType {
  switch (s.kind) {
    case 'new': case 'learning': return RevlogType.Learn;
    case 'review': return daysLate(s) < 0 ? RevlogType.Filtered : RevlogType.Review;
    case 'relearning': return RevlogType.Relearn;
  }
}
export const leeched = (s: CardState) => (s.kind === 'review' ? s.leeched : s.kind === 'relearning' ? s.review.leeched : false);
export const memoryOf = (s: CardState): MemoryState | undefined =>
  s.kind === 'learning' || s.kind === 'review' ? s.memory : s.kind === 'relearning' ? s.learning.memory : undefined;

// ---- steps.rs ----
export class LearningSteps {
  constructor(readonly steps: number[]) {} // minutes
  private idx(remaining: number) { const n = this.steps.length; return Math.min(Math.max(0, n - (remaining % 1000)), Math.max(0, n - 1)); }
  private secsAt(i: number) { const m = this.steps[i]; return m === undefined ? undefined : Math.floor(m * 60); }
  againDelaySecsLearn() { return this.secsAt(0); }
  hardDelaySecs(remaining: number) {
    const idx = this.idx(remaining);
    const cur = this.secsAt(idx) ?? this.secsAt(0);
    if (cur === undefined) return undefined;
    if (idx !== 0) return cur;
    const next = this.secsAt(1);
    return roundInDays(next !== undefined ? Math.floor((cur + next) / 2) : Math.min(Math.floor(cur * 3 / 2), cur + DAY));
  }
  goodDelaySecs(remaining: number) { return this.secsAt(this.idx(remaining) + 1); }
  currentDelaySecs(remaining: number) { return this.secsAt(this.idx(remaining)) ?? 0; }
  remainingForGood(remaining: number) { return Math.max(0, this.steps.length - (this.idx(remaining) + 1)); }
  remainingForFailed() { return this.steps.length; }
  isEmpty() { return this.steps.length === 0; }
}
const roundInDays = (secs: number) => (secs > DAY ? Math.round(secs / DAY) * DAY : secs);

// ---- fuzz.rs ----
const FUZZ_RANGES = [[2.5, 7, 0.15], [7, 20, 0.1], [20, Infinity, 0.05]] as const;
const fuzzDelta = (ivl: number) => (ivl < 2.5 ? 0 : FUZZ_RANGES.reduce((d, [s, e, f]) => d + f * Math.max(0, Math.min(ivl, e) - s), 1));
const fuzzBounds = (ivl: number): [number, number] => { const d = fuzzDelta(ivl); return [Math.round(ivl - d), Math.round(ivl + d)]; };
export function constrainedFuzzBounds(interval: number, minimum: number, maximum: number): [number, number] {
  minimum = Math.min(minimum, maximum);
  interval = Math.min(Math.max(interval, minimum), maximum);
  let [lo, hi] = fuzzBounds(interval);
  lo = Math.min(Math.max(lo, minimum), maximum); hi = Math.min(Math.max(hi, minimum), maximum);
  if (hi === lo && hi > 2 && hi < maximum) hi = lo + 1;
  return [lo, hi];
}
export function withReviewFuzz(fuzz: number | undefined, interval: number, minimum: number, maximum: number): number {
  if (fuzz === undefined) return Math.min(Math.max(Math.round(interval), minimum), maximum);
  const [lo, hi] = constrainedFuzzBounds(interval, minimum, maximum);
  return Math.floor(lo + fuzz * (1 + hi - lo));
}
export function minimumReviewFuzzInterval(interval: number, previous: number, maximum: number): number {
  const rounded = Math.round(interval);
  const [, upper] = constrainedFuzzBounds(interval, 1, maximum);
  return rounded > previous ? previous + 1 : previous <= upper ? previous : 0;
}

// ---- StateContext ----
export interface StateContext {
  fuzzFactor?: number;
  steps: LearningSteps; relearnSteps: LearningSteps;
  graduatingIntervalGood: number; graduatingIntervalEasy: number; initialEaseFactor: number;
  hardMultiplier: number; easyMultiplier: number; intervalMultiplier: number; maximumReviewInterval: number;
  leechThreshold: number; lapseMultiplier: number; minimumLapseInterval: number;
  fsrsNextStates?: NextStates; fsrsShortTermWithStepsEnabled: boolean; fsrsAllowShortTerm: boolean;
}
export const minAndMax = (ctx: StateContext, minimum: number): [number, number] => {
  const max = Math.max(1, ctx.maximumReviewInterval);
  return [Math.min(Math.max(minimum, 1), max), max];
};
const ctxFuzz = (ctx: StateContext, ivl: number, min: number, max: number) => withReviewFuzz(ctx.fuzzFactor, ivl, min, max);

// ---- new.rs ----
const newNext = (s: NewState, ctx: StateContext): SchedulingStates => {
  const l: LearnState = { kind: 'learning', remainingSteps: ctx.steps.remainingForFailed(), scheduledSecs: 0, elapsedSecs: 0 };
  const n = learnNext(l, ctx);
  return { ...n, current: s };
};

// ---- learning.rs ----
function graduateOrShortTerm(l: LearnState, ctx: StateContext, item: keyof NextStates, remainingFailed: boolean): CardState {
  const memory = ctx.fsrsNextStates?.[item].memory;
  const [min, max] = minAndMax(ctx, 1);
  const st = ctx.fsrsNextStates;
  const [interval, shortTerm] = st
    ? [st[item].interval, ctx.fsrsAllowShortTerm && (ctx.fsrsShortTermWithStepsEnabled || ctx.steps.isEmpty()) && st[item].interval < 0.5]
    : [ctx.graduatingIntervalGood, false];
  if (shortTerm) return { kind: 'learning', remainingSteps: remainingFailed ? ctx.steps.remainingForFailed() : l.remainingSteps, scheduledSecs: Math.floor(interval * DAY), elapsedSecs: 0, memory };
  return { kind: 'review', scheduledDays: ctxFuzz(ctx, Math.max(1, Math.round(interval)), min, max), elapsedDays: 0, easeFactor: ctx.initialEaseFactor, lapses: 0, leeched: false, memory };
}
function learnNext(s: LearnState, ctx: StateContext): SchedulingStates {
  const st = ctx.fsrsNextStates;
  const again: CardState = (() => {
    const d = ctx.steps.againDelaySecsLearn();
    return d !== undefined ? { kind: 'learning', remainingSteps: ctx.steps.remainingForFailed(), scheduledSecs: d, elapsedSecs: 0, memory: st?.again.memory } : graduateOrShortTerm(s, ctx, 'again', true);
  })();
  const hard: CardState = (() => {
    const d = ctx.steps.hardDelaySecs(s.remainingSteps);
    return d !== undefined ? { ...s, scheduledSecs: d, elapsedSecs: 0, memory: st?.hard.memory } : graduateOrShortTerm(s, ctx, 'hard', false);
  })();
  const good: CardState = (() => {
    const d = ctx.steps.goodDelaySecs(s.remainingSteps);
    return d !== undefined ? { kind: 'learning', remainingSteps: ctx.steps.remainingForGood(s.remainingSteps), scheduledSecs: d, elapsedSecs: 0, memory: st?.good.memory } : graduateOrShortTerm(s, ctx, 'good', false);
  })();
  const easy: CardState = (() => {
    let [min, max] = minAndMax(ctx, 1);
    let interval: number;
    if (st) { const g = ctxFuzz(ctx, st.good.interval, min, max); min = g + 1; interval = Math.max(1, Math.round(st.easy.interval)); }
    else interval = ctx.graduatingIntervalEasy;
    return { kind: 'review', scheduledDays: ctxFuzz(ctx, interval, min, max), elapsedDays: 0, easeFactor: ctx.initialEaseFactor, lapses: 0, leeched: false, memory: st?.easy.memory };
  })();
  return { current: s, again, hard, good, easy };
}

// ---- review.rs ----
export const leechThresholdMet = (lapses: number, threshold: number) =>
  threshold > 0 && lapses >= threshold && (lapses - threshold) % Math.max(1, Math.ceil(threshold / 2)) === 0;

function constrainPassing(ctx: StateContext, interval: number, minimum: number, fuzz: boolean) {
  if (!ctx.fsrsNextStates) interval *= ctx.intervalMultiplier;
  const [min, max] = minAndMax(ctx, minimum);
  return fuzz ? ctxFuzz(ctx, interval, min, max) : Math.min(Math.max(Math.round(interval), min), max);
}
export function passingReviewIntervals(s: Omit<ReviewState, 'kind'>, ctx: StateContext): [number, number, number] {
  const st = ctx.fsrsNextStates;
  if (st) {
    const m = (ivl: number) => minimumReviewFuzzInterval(ivl, s.scheduledDays, ctx.maximumReviewInterval);
    const hard = constrainPassing(ctx, st.hard.interval, Math.max(1, m(st.hard.interval)), true);
    const good = constrainPassing(ctx, st.good.interval, Math.max(hard + 1, m(st.good.interval)), true);
    const easy = constrainPassing(ctx, st.easy.interval, Math.max(good + 1, m(st.easy.interval)), true);
    return [hard, good, easy];
  }
  const scheduled = Math.max(1, s.scheduledDays);
  if (daysLate(s) < 0) {
    const elapsed = s.elapsedDays;
    const hard = constrainPassing(ctx, Math.max(elapsed * ctx.hardMultiplier, scheduled * ctx.hardMultiplier / 2), 0, false);
    const good = constrainPassing(ctx, Math.max(elapsed * s.easeFactor, scheduled), 0, false);
    const reduced = ctx.easyMultiplier - (ctx.easyMultiplier - 1) / 2;
    const easy = constrainPassing(ctx, Math.max(elapsed * s.easeFactor, scheduled) * reduced, 0, false);
    return [hard, good, easy];
  }
  const late = Math.max(0, daysLate(s));
  const hf = ctx.hardMultiplier;
  const hard = constrainPassing(ctx, scheduled * hf, hf <= 1 ? 0 : s.scheduledDays + 1, true);
  const good = constrainPassing(ctx, (scheduled + late / 2) * s.easeFactor, hf <= 1 ? s.scheduledDays + 1 : hard + 1, true);
  const easy = constrainPassing(ctx, (scheduled + late) * s.easeFactor * ctx.easyMultiplier, good + 1, true);
  return [hard, good, easy];
}
export function failingReviewInterval(s: Omit<ReviewState, 'kind'>, ctx: StateContext): [number, MemoryState | undefined] {
  const st = ctx.fsrsNextStates;
  if (st) return [st.again.interval, st.again.memory];
  const [min, max] = minAndMax(ctx, ctx.minimumLapseInterval);
  return [ctxFuzz(ctx, Math.max(1, s.scheduledDays) * ctx.lapseMultiplier, min, max), undefined];
}
function reviewNext(s: ReviewState, ctx: StateContext): SchedulingStates {
  const [hard, good, easy] = passingReviewIntervals(s, ctx);
  const st = ctx.fsrsNextStates;
  const lapses = s.lapses + 1;
  const [days, memory] = failingReviewInterval(s, ctx);
  const againReview: ReviewState = { kind: 'review', scheduledDays: Math.max(1, Math.round(days)), elapsedDays: 0, easeFactor: Math.max(MIN_EASE, s.easeFactor + EASE_AGAIN), lapses, leeched: leechThresholdMet(lapses, ctx.leechThreshold), memory };
  const { kind: _k, ...review } = againReview;
  const againDelay = ctx.relearnSteps.againDelaySecsLearn();
  const again: CardState = againDelay !== undefined
    ? { kind: 'relearning', learning: { remainingSteps: ctx.relearnSteps.remainingForFailed(), scheduledSecs: againDelay, elapsedSecs: 0, memory }, review }
    : ctx.fsrsAllowShortTerm && (ctx.fsrsShortTermWithStepsEnabled || ctx.relearnSteps.isEmpty()) && days < 0.5
      ? { kind: 'relearning', learning: { remainingSteps: ctx.relearnSteps.remainingForFailed(), scheduledSecs: Math.floor(days * DAY), elapsedSecs: 0, memory }, review }
      : againReview;
  const pass = (scheduledDays: number, ease: number, memory?: MemoryState): ReviewState => ({ ...s, scheduledDays, elapsedDays: 0, easeFactor: ease, memory });
  return {
    current: s, again,
    hard: pass(hard, Math.max(MIN_EASE, s.easeFactor + EASE_HARD), st?.hard.memory),
    good: pass(good, s.easeFactor, st?.good.memory),
    easy: pass(easy, s.easeFactor + EASE_EASY, st?.easy.memory),
  };
}

// ---- relearning.rs ----
function relearnNext(s: RelearnState, ctx: StateContext): SchedulingStates {
  const st = ctx.fsrsNextStates;
  const steps = ctx.relearnSteps;
  const l = s.learning, r = s.review;
  const toReview = (item: keyof NextStates, scheduledDays: number): CardState => {
    const [min, max] = minAndMax(ctx, 1);
    if (st) {
      const days = st[item].interval;
      if (ctx.fsrsAllowShortTerm && (ctx.fsrsShortTermWithStepsEnabled || steps.isEmpty()) && days < 0.5)
        return { kind: 'relearning', learning: { ...l, scheduledSecs: Math.floor(days * DAY), elapsedSecs: 0, memory: st[item].memory }, review: r };
      return { kind: 'review', ...r, scheduledDays: ctxFuzz(ctx, Math.max(1, Math.round(days)), min, max), elapsedDays: 0, memory: st[item].memory };
    }
    return { kind: 'review', ...r, scheduledDays, elapsedDays: 0 };
  };
  const again: CardState = (() => {
    const d = steps.againDelaySecsLearn();
    if (d !== undefined) {
      const [min, max] = minAndMax(ctx, ctx.minimumLapseInterval);
      const ivl = st ? r.scheduledDays : ctxFuzz(ctx, Math.max(1, r.scheduledDays) * ctx.lapseMultiplier, min, max);
      return { kind: 'relearning', learning: { remainingSteps: steps.remainingForFailed(), scheduledSecs: d, elapsedSecs: 0, memory: st?.again.memory }, review: { ...r, scheduledDays: ivl, memory: st?.again.memory } };
    }
    return toReview('again', r.scheduledDays);
  })();
  const hard: CardState = (() => {
    const d = steps.hardDelaySecs(l.remainingSteps);
    return d !== undefined ? { kind: 'relearning', learning: { ...l, scheduledSecs: d, elapsedSecs: 0, memory: st?.hard.memory }, review: r } : toReview('hard', r.scheduledDays);
  })();
  const good: CardState = (() => {
    const d = steps.goodDelaySecs(l.remainingSteps);
    return d !== undefined ? { kind: 'relearning', learning: { remainingSteps: steps.remainingForGood(l.remainingSteps), scheduledSecs: d, elapsedSecs: 0, memory: st?.good.memory }, review: r } : toReview('good', r.scheduledDays);
  })();
  const easy: CardState = (() => {
    const [min, max] = minAndMax(ctx, 1);
    if (st) {
      const good = ctxFuzz(ctx, Math.max(1, Math.round(st.good.interval)), min, max);
      return { kind: 'review', ...r, scheduledDays: ctxFuzz(ctx, Math.max(1, Math.round(st.easy.interval)), good + 1, max), elapsedDays: 0, memory: st.easy.memory };
    }
    return { kind: 'review', ...r, scheduledDays: Math.min(max, r.scheduledDays + 1), elapsedDays: 0 };
  })();
  return { current: s, again, hard, good, easy };
}

export function nextStates(s: CardState, ctx: StateContext): SchedulingStates {
  switch (s.kind) {
    case 'new': return newNext(s, ctx);
    case 'learning': return learnNext(s, ctx);
    case 'review': return reviewNext(s, ctx);
    case 'relearning': return relearnNext(s, ctx);
  }
}
export const stateFor = (states: SchedulingStates, r: Rating): CardState =>
  r === Rating.Again ? states.again : r === Rating.Hard ? states.hard : r === Rating.Good ? states.good : states.easy;
