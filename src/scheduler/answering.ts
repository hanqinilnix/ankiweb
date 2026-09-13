// Port of rslib/src/scheduler/answering/{mod,current,learning,review,relearning,revlog}.rs
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import { CardType, LeechAction, Queue, Rating, type Card, type Collection, type Deck, type DeckConfig, type RevlogEntry } from '../model/types';
import { Fsrs, type MemoryState, type NextStates } from './fsrs';
import { asRevlogInterval, asSeconds, intervalKind, leeched, LearningSteps, maybeAsDays, memoryOf, nextStates, revlogKind, stateFor, type CardState, type SchedulingStates, type StateContext } from './states';
import { answerButtonTimeCollapsible } from './timespan';
import { type SchedTimingToday } from './timing';

const DAY = 86400;

// Anki seeds StdRng (ChaCha) with card id + reps; we use a splitmix-style hash on the same seed. Different stream, same intent.
export function fuzzFactorFromSeed(seed: number | undefined): number | undefined {
  if (seed === undefined) return undefined;
  let a = BigInt.asUintN(64, BigInt(seed) + 0x9e3779b97f4a7c15n);
  a = BigInt.asUintN(64, (a ^ (a >> 30n)) * 0xbf58476d1ce4e5b9n);
  a = BigInt.asUintN(64, (a ^ (a >> 27n)) * 0x94d049bb133111ebn);
  a ^= a >> 31n;
  return Number(a >> 11n) / 2 ** 53;
}
export const fuzzSeed = (card: Card, forReschedule = false) => card.id + (forReschedule ? Math.max(0, card.reps - 1) : card.reps);

export interface Updater {
  card: Card; deck: Deck; cfg: DeckConfig; timing: SchedTimingToday; now: number;
  fuzzSeed?: number; fsrsNext?: NextStates; desiredRetention?: number; fsrsShortTermWithSteps: boolean; fsrsAllowShortTerm: boolean;
}

export function makeUpdater(card: Card, deck: Deck, cfg: DeckConfig, col: Collection, timing: SchedTimingToday, now: Date, lastReviewSecs: number | undefined, opts: { fuzz?: boolean } = {}): Updater {
  const fsrsEnabled = col.fsrs;
  let fsrsNext: NextStates | undefined, allowShort = false;
  const c = { ...card };
  if (fsrsEnabled) {
    const fsrs = new Fsrs(cfg.fsrsParams);
    if (!c.fsrs && c.type !== CardType.New) {
      // Anki rebuilds memory from the revlog; we use the SM-2 conversion as a cheaper stand-in.
      const m = fsrs.memoryStateFromSm2(c.factor / 1000 || 2.5, Math.max(1, c.ivl), 0.9);
      if (m) c.fsrs = { s: m.stability, d: m.difficulty };
    }
    const daysElapsed = lastReviewSecs !== undefined ? Math.max(0, Math.floor((timing.nextDayAt - lastReviewSecs) / DAY)) : 0;
    fsrsNext = fsrs.nextStates(c.fsrs ? { stability: c.fsrs.s, difficulty: c.fsrs.d } : undefined, cfg.desiredRetention, daysElapsed);
    const p = cfg.fsrsParams;
    allowShort = p.length >= 19 ? p[17]! > 0 && p[18]! > 0 : p.length === 0;
  }
  return {
    card: c, deck, cfg, timing, now: Math.floor(now.getTime() / 1000),
    fuzzSeed: opts.fuzz === false ? undefined : fuzzSeed(card),
    fsrsNext, desiredRetention: fsrsEnabled ? cfg.desiredRetention : undefined,
    fsrsShortTermWithSteps: false, fsrsAllowShortTerm: allowShort,
  };
}

export function stateContext(u: Updater): StateContext {
  const c = u.cfg;
  return {
    fuzzFactor: fuzzFactorFromSeed(u.fuzzSeed),
    steps: new LearningSteps(c.learnSteps), relearnSteps: new LearningSteps(c.relearnSteps),
    graduatingIntervalGood: c.graduatingIvl, graduatingIntervalEasy: c.easyIvl, initialEaseFactor: c.startEase,
    hardMultiplier: c.hardMult, easyMultiplier: c.easyMult, intervalMultiplier: c.ivlMult, maximumReviewInterval: c.maxIvl,
    leechThreshold: c.leechThreshold, lapseMultiplier: c.lapseMult, minimumLapseInterval: c.minLapseIvl,
    fsrsNextStates: u.fsrsNext, fsrsShortTermWithStepsEnabled: u.fsrsShortTermWithSteps, fsrsAllowShortTerm: u.fsrsAllowShortTerm,
  };
}

// current.rs
export function currentCardState(u: Updater): CardState {
  const c = u.card, steps = new LearningSteps(u.cfg.learnSteps), relearn = new LearningSteps(u.cfg.relearnSteps);
  const due = c.type === CardType.Review ? Math.min(c.due, u.timing.daysElapsed) : c.due;
  const memory: MemoryState | undefined = c.fsrs ? { stability: c.fsrs.s, difficulty: c.fsrs.d } : undefined;
  const remaining = c.left % 1000;
  const elapsedSecs = (lastIvl: number) => {
    if (c.queue === Queue.Learn) {
      const withFuzz = learningIvlWithFuzz(fuzzSeed(c, true), lastIvl);
      return Math.max(0, u.now - (due - withFuzz));
    }
    if (c.queue === Queue.DayLearn) return (u.timing.daysElapsed - due + Math.max(1, Math.floor(lastIvl / DAY))) * DAY;
    return 0;
  };
  switch (c.type) {
    case CardType.New: return { kind: 'new', position: Math.max(0, due) };
    case CardType.Learn: { const l = steps.currentDelaySecs(remaining); return { kind: 'learning', scheduledSecs: l, remainingSteps: remaining, elapsedSecs: elapsedSecs(l), memory }; }
    case CardType.Review: return { kind: 'review', scheduledDays: c.ivl, elapsedDays: Math.max(0, c.ivl - (due - u.timing.daysElapsed)), easeFactor: c.factor / 1000, lapses: c.lapses, leeched: false, memory };
    case CardType.Relearn: { const l = relearn.currentDelaySecs(remaining); return { kind: 'relearning', learning: { scheduledSecs: l, elapsedSecs: elapsedSecs(l), remainingSteps: remaining, memory }, review: { scheduledDays: c.ivl, elapsedDays: c.ivl, easeFactor: c.factor / 1000, lapses: c.lapses, leeched: false, memory } }; }
  }
}

export const schedulingStates = (u: Updater): SchedulingStates => nextStates(currentCardState(u), stateContext(u));

export function describeNextStates(u: Updater, learnAheadSecs: number): Record<Rating, string> {
  const s = schedulingStates(u);
  const secsUntilRollover = Math.max(0, u.timing.nextDayAt - u.now);
  const d = (st: CardState) => answerButtonTimeCollapsible(asSeconds(maybeAsDays(intervalKind(st), secsUntilRollover)), learnAheadSecs);
  return { [Rating.Again]: d(s.again), [Rating.Hard]: d(s.hard), [Rating.Good]: d(s.good), [Rating.Easy]: d(s.easy) };
}

// learning.rs fuzz: seeded upper bound of +25% (max 300s)
export function learningIvlWithFuzz(seed: number | undefined, secs: number): number {
  const f = fuzzFactorFromSeed(seed);
  if (f === undefined) return secs;
  const upper = secs + Math.floor(Math.min(secs * 0.25, 300));
  return secs >= upper ? secs : secs + Math.floor(f * (upper - secs));
}

export interface AnswerResult { card: Card; revlog: RevlogEntry; leeched: boolean; fromQueue: Queue; newDelta: number; reviewDelta: number }

export function answerCard(u: Updater, rating: Rating, answeredAtMs: number, takenMs: number): AnswerResult {
  const current = currentCardState(u);
  const states = nextStates(current, stateContext(u));
  const next = stateFor(states, rating);
  const c: Card = { ...u.card, reps: u.card.reps + 1 };
  const secsUntilRollover = Math.max(0, u.timing.nextDayAt - u.now);
  const setMem = (m?: MemoryState) => { if (m) c.fsrs = { s: m.stability, d: m.difficulty }; else delete c.fsrs; };
  let easeForRevlog: number;
  const applyLearn = (l: { remainingSteps: number; scheduledSecs: number; memory?: MemoryState }, type: CardType) => {
    c.left = l.remainingSteps; c.type = type; setMem(l.memory);
    const ivl = maybeAsDays({ secs: l.scheduledSecs }, secsUntilRollover);
    if ('secs' in ivl) { c.queue = Queue.Learn; c.due = u.now + learningIvlWithFuzz(u.fuzzSeed, ivl.secs); }
    else { c.queue = Queue.DayLearn; c.due = u.timing.daysElapsed + ivl.days; }
  };
  switch (next.kind) {
    case 'new': c.type = CardType.New; c.queue = Queue.New; c.due = next.position; easeForRevlog = 0; break;
    case 'learning': applyLearn(next, CardType.Learn); easeForRevlog = 0; break;
    case 'review':
      c.queue = Queue.Review; c.type = CardType.Review; c.ivl = next.scheduledDays; c.due = u.timing.daysElapsed + next.scheduledDays;
      c.factor = Math.round(next.easeFactor * 1000); c.lapses = next.lapses; c.left = 0; setMem(next.memory);
      easeForRevlog = next.easeFactor; break;
    case 'relearning':
      c.ivl = next.review.scheduledDays; c.lapses = next.review.lapses; c.factor = Math.round(next.review.easeFactor * 1000);
      applyLearn(next.learning, CardType.Relearn); easeForRevlog = next.review.easeFactor; break;
  }
  const isLeech = leeched(next);
  if (isLeech && u.cfg.leechAction === LeechAction.Suspend) c.queue = Queue.Suspended;
  c.mod = Math.floor(answeredAtMs / 1000);
  // revlog.rs: memory difficulty (shifted) takes precedence when present
  const mem = memoryOf(next);
  const factor = mem ? mem.difficulty : easeForRevlog;
  const revlog: RevlogEntry = {
    id: answeredAtMs, cid: c.id, ease: rating,
    ivl: asRevlogInterval(maybeAsDays(intervalKind(next), secsUntilRollover)),
    lastIvl: asRevlogInterval(maybeAsDays(intervalKind(current), secsUntilRollover)),
    factor: Math.round(factor * 1000), time: Math.min(takenMs, u.cfg.capAnswerSecs * 1000), type: revlogKind(current),
  };
  const fromQueue = u.card.queue;
  return { card: c, revlog, leeched: isLeech, fromQueue, newDelta: fromQueue === Queue.New ? 1 : 0, reviewDelta: fromQueue === Queue.Review || fromQueue === Queue.DayLearn ? 1 : 0 };
}
