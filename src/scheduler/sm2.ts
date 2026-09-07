// Port of Anki's non-FSRS scheduler (rslib/src/scheduler/states/{steps,learning,relearning,review,fuzz}.rs).
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import { CardType, Queue, Rating, type Card, type Collection, type DeckConfig } from '../model/types';
import { fmtIvl, revlogFor, today, type Scheduler } from './index';

const DAY = 86400;
const MIN_EASE = 1.3, AGAIN_DELTA = -0.2, HARD_DELTA = -0.15, EASY_DELTA = 0.15;

// ---- steps.rs ----
const toSecs = (m: number) => Math.floor(m * 60);
const roundDays = (s: number) => (s > DAY ? Math.round(s / DAY) * DAY : s);
const stepIdx = (steps: number[], remaining: number) => Math.min(Math.max(0, steps.length - (remaining % 1000)), Math.max(0, steps.length - 1));
const secsAt = (steps: number[], i: number) => (steps[i] === undefined ? undefined : toSecs(steps[i]!));
const againSecs = (steps: number[]) => secsAt(steps, 0);
function hardSecs(steps: number[], remaining: number) {
  const idx = stepIdx(steps, remaining);
  const cur = secsAt(steps, idx) ?? againSecs(steps);
  if (cur === undefined) return undefined;
  if (idx !== 0) return cur;
  const next = secsAt(steps, 1);
  return roundDays(next !== undefined ? Math.floor((cur + next) / 2) : Math.min(Math.floor(cur * 3 / 2), cur + DAY));
}
const goodSecs = (steps: number[], remaining: number) => secsAt(steps, stepIdx(steps, remaining) + 1);
const remainingForGood = (steps: number[], remaining: number) => Math.max(0, steps.length - (stepIdx(steps, remaining) + 1));

// ---- fuzz.rs ----
const FUZZ = [[2.5, 7, 0.15], [7, 20, 0.1], [20, Infinity, 0.05]] as const;
const fuzzDelta = (ivl: number) => (ivl < 2.5 ? 0 : FUZZ.reduce((d, [s, e, f]) => d + f * Math.max(0, Math.min(ivl, e) - s), 1));
function fuzzBounds(ivl: number, min: number, max: number): [number, number] {
  min = Math.min(min, max);
  ivl = Math.min(Math.max(ivl, min), max);
  const d = fuzzDelta(ivl);
  let lo = Math.min(Math.max(Math.round(ivl - d), min), max), hi = Math.min(Math.max(Math.round(ivl + d), min), max);
  if (hi === lo && hi > 2 && hi < max) hi = lo + 1;
  return [lo, hi];
}
function withFuzz(factor: number | undefined, ivl: number, min: number, max: number): number {
  if (factor === undefined) return Math.min(Math.max(Math.round(ivl), min), max);
  const [lo, hi] = fuzzBounds(ivl, min, max);
  return Math.floor(lo + factor * (1 + hi - lo));
}
// Anki seeds StdRng with card id + reps; we use mulberry32 on the same seed (different stream, same intent).
function fuzzFactor(card: Card): number {
  let a = (card.id + card.reps) >>> 0;
  a = Math.imul(a ^ (a >>> 15), a | 1); a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

// ---- state machine ----
interface Ctx { cfg: DeckConfig; col: Collection; now: Date; fuzz?: number }
const minMax = (ctx: Ctx, min: number): [number, number] => [Math.max(1, min), Math.max(1, ctx.cfg.maxIvl)];
const learnDue = (ctx: Ctx, secs: number) => Math.floor(ctx.now.getTime() / 1000 + secs);
const leech = (lapses: number, t: number) => t > 0 && lapses >= t && (lapses - t) % Math.max(1, Math.ceil(t / 2)) === 0;

function learn(c: Card, secs: number, remaining: number, ctx: Ctx): Card {
  const dayLearn = secs >= DAY;
  return { ...c, left: remaining, queue: dayLearn ? Queue.DayLearn : Queue.Learn, due: dayLearn ? today(ctx.col, ctx.now) + Math.round(secs / DAY) : learnDue(ctx, secs) };
}
function review(c: Card, days: number, ctx: Ctx, factor = c.factor): Card {
  return { ...c, type: CardType.Review, queue: Queue.Review, left: 0, ivl: days, due: today(ctx.col, ctx.now) + days, factor: Math.round(factor) };
}

function nextLearn(c: Card, r: Rating, ctx: Ctx): Card {
  const { cfg } = ctx;
  const relearn = c.type === CardType.Relearn;
  const steps = relearn ? cfg.relearnSteps : cfg.learnSteps;
  const base = c.type === CardType.New ? { ...c, type: CardType.Learn, left: steps.length, factor: Math.round(cfg.startEase * 1000) } : c;
  const [min, max] = minMax(ctx, 1);
  const grad = (days: number, minimum = min) => review(base, withFuzz(ctx.fuzz, Math.max(1, Math.round(days)), minimum, max), ctx);
  if (r === Rating.Easy) return relearn ? grad(c.ivl + 1) : grad(cfg.easyIvl);
  if (r === Rating.Again) {
    const s = againSecs(steps);
    if (relearn) {
      const ivl = withFuzz(ctx.fuzz, Math.max(1, c.ivl) * cfg.lapseMult, Math.max(1, cfg.minLapseIvl), max);
      return s === undefined ? review(base, ivl, ctx) : learn({ ...base, ivl }, s, steps.length, ctx);
    }
    return s === undefined ? grad(cfg.graduatingIvl) : learn(base, s, steps.length, ctx);
  }
  if (r === Rating.Hard) {
    const s = hardSecs(steps, base.left);
    return s === undefined ? (relearn ? review(base, c.ivl, ctx) : grad(cfg.graduatingIvl)) : learn(base, s, base.left, ctx);
  }
  const s = goodSecs(steps, base.left);
  return s === undefined ? (relearn ? review(base, c.ivl, ctx) : grad(cfg.graduatingIvl)) : learn(base, s, remainingForGood(steps, base.left), ctx);
}

function nextReview(c: Card, r: Rating, ctx: Ctx): Card {
  const { cfg } = ctx;
  const ease = c.factor / 1000;
  const constrain = (ivl: number, minimum: number, fuzz: boolean) => {
    const [min, max] = minMax(ctx, minimum);
    ivl *= cfg.ivlMult;
    return fuzz ? withFuzz(ctx.fuzz, ivl, min, max) : Math.min(Math.max(Math.round(ivl), min), max);
  };
  if (r === Rating.Again) {
    const lapses = c.lapses + 1;
    const [min, max] = minMax(ctx, cfg.minLapseIvl);
    const ivl = withFuzz(ctx.fuzz, Math.max(1, c.ivl) * cfg.lapseMult, min, max);
    const factor = Math.max(MIN_EASE, ease + AGAIN_DELTA) * 1000;
    const flags = leech(lapses, cfg.leechThreshold) ? c.flags | 0x80 : c.flags; // leech marker bit, app-local
    const lapsed = { ...c, type: CardType.Relearn, lapses, ivl, factor: Math.round(factor), flags };
    const s = againSecs(cfg.relearnSteps);
    return s === undefined ? review(lapsed, ivl, ctx) : learn(lapsed, s, cfg.relearnSteps.length, ctx);
  }
  const scheduled = Math.max(1, c.ivl);
  const elapsed = today(ctx.col, ctx.now) - (c.due - c.ivl);
  const late = elapsed - c.ivl;
  let hard: number, good: number, easy: number;
  if (late < 0) {
    hard = constrain(Math.max(elapsed * cfg.hardMult, scheduled * cfg.hardMult / 2), 0, false);
    good = constrain(Math.max(elapsed * ease, scheduled), 0, false);
    easy = constrain(Math.max(elapsed * ease, scheduled) * (cfg.easyMult - (cfg.easyMult - 1) / 2), 0, false);
  } else {
    hard = constrain(scheduled * cfg.hardMult, cfg.hardMult <= 1 ? 0 : c.ivl + 1, true);
    good = constrain((scheduled + late / 2) * ease, cfg.hardMult <= 1 ? c.ivl + 1 : hard + 1, true);
    easy = constrain((scheduled + late) * ease * cfg.easyMult, good + 1, true);
  }
  if (r === Rating.Hard) return review(c, hard, ctx, Math.max(MIN_EASE, ease + HARD_DELTA) * 1000);
  if (r === Rating.Good) return review(c, good, ctx);
  return review(c, easy, ctx, (ease + EASY_DELTA) * 1000);
}

const next = (card: Card, r: Rating, ctx: Ctx): Card => {
  const c = { ...card, reps: card.reps + 1 };
  return c.type === CardType.Review ? nextReview(c, r, ctx) : nextLearn(c, r, ctx);
};

export function makeSm2(opts: { fuzz: boolean } = { fuzz: true }): Scheduler {
  const ctxFor = (card: Card, cfg: DeckConfig, col: Collection, now: Date): Ctx => ({ cfg, col, now, ...(opts.fuzz && { fuzz: fuzzFactor(card) }) });
  return {
    answer(card, rating, cfg, col, now, elapsedMs) {
      const nc = next(card, rating, ctxFor(card, cfg, col, now));
      return { card: nc, revlog: revlogFor(nc, card, rating, now, elapsedMs) };
    },
    preview(card, cfg, col, now) {
      const ctx = ctxFor(card, cfg, col, now);
      const f = (r: Rating) => {
        const c = next(card, r, ctx);
        return c.queue === Queue.Learn ? fmtIvl(0, (c.due - now.getTime() / 1000) / 60) : fmtIvl(c.due - today(col, now));
      };
      return { [Rating.Again]: f(Rating.Again), [Rating.Hard]: f(Rating.Hard), [Rating.Good]: f(Rating.Good), [Rating.Easy]: f(Rating.Easy) };
    },
  };
}
export const sm2 = makeSm2();
