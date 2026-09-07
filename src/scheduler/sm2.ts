import { CardType, Queue, Rating, type Card, type Collection, type DeckConfig } from '../model/types';
import { fmtIvl, revlogFor, today, type Scheduler } from './index';

// Anki SM-2 (v3 scheduler semantics, no fuzz). `left` = remaining steps.
const learnDue = (now: Date, mins: number) => Math.floor(now.getTime() / 1000 + mins * 60);
const clampIvl = (ivl: number, cfg: DeckConfig) => Math.min(cfg.maxIvl, Math.max(1, Math.round(ivl)));

function step(card: Card, steps: number[], idx: number, now: Date, cfg: DeckConfig, col: Collection): Card {
  const mins = steps[idx] ?? 1;
  const dayLearn = mins >= 1440;
  return {
    ...card, left: steps.length - idx,
    queue: dayLearn ? Queue.DayLearn : Queue.Learn,
    due: dayLearn ? today(col, now) + Math.round(mins / 1440) : learnDue(now, mins),
  };
}

function graduate(card: Card, ivl: number, cfg: DeckConfig, col: Collection, now: Date): Card {
  return { ...card, type: CardType.Review, queue: Queue.Review, left: 0, ivl: clampIvl(ivl, cfg), due: today(col, now) + clampIvl(ivl, cfg), factor: card.factor || Math.round(cfg.startEase * 1000) };
}

function next(card: Card, r: Rating, cfg: DeckConfig, col: Collection, now: Date): Card {
  const c = { ...card, reps: card.reps + 1 };
  if (c.type === CardType.New || c.type === CardType.Learn || c.type === CardType.Relearn) {
    const relearn = c.type === CardType.Relearn;
    const steps = relearn ? cfg.relearnSteps : cfg.learnSteps;
    const idx = c.type === CardType.New ? 0 : steps.length - c.left;
    const base = c.type === CardType.New ? { ...c, type: CardType.Learn, factor: Math.round(cfg.startEase * 1000) } : c;
    if (r === Rating.Again) return step(base, steps, 0, now, cfg, col);
    if (r === Rating.Hard) return step(base, steps, Math.max(0, idx), now, cfg, col);
    if (r === Rating.Easy) return graduate(base, relearn ? c.ivl : cfg.easyIvl, cfg, col, now);
    return idx + 1 < steps.length ? step(base, steps, idx + 1, now, cfg, col) : graduate(base, relearn ? c.ivl : cfg.graduatingIvl, cfg, col, now);
  }
  // review
  const ease = c.factor / 1000;
  if (r === Rating.Again) {
    const lapsed = { ...c, type: CardType.Relearn, lapses: c.lapses + 1, factor: Math.max(1300, c.factor - 200), ivl: clampIvl(c.ivl * 0, cfg) };
    return cfg.relearnSteps.length ? step(lapsed, cfg.relearnSteps, 0, now, cfg, col) : graduate(lapsed, lapsed.ivl, cfg, col, now);
  }
  const delay = Math.max(0, today(col, now) - c.due); // overdue days
  const ivl = r === Rating.Hard ? c.ivl * 1.2 : r === Rating.Good ? (c.ivl + delay / 2) * ease : (c.ivl + delay) * ease * 1.3;
  const factor = r === Rating.Hard ? c.factor - 150 : r === Rating.Easy ? c.factor + 150 : c.factor;
  return graduate({ ...c, factor: Math.max(1300, factor) }, Math.max(ivl, c.ivl + 1), cfg, col, now);
}

export const sm2: Scheduler = {
  answer(card, rating, cfg, col, now, elapsedMs) {
    const nc = next(card, rating, cfg, col, now);
    return { card: nc, revlog: revlogFor(nc, card, rating, now, elapsedMs) };
  },
  preview(card, cfg, col, now) {
    const f = (r: Rating) => {
      const c = next(card, r, cfg, col, now);
      if (c.queue === Queue.Learn) return fmtIvl(0, (c.due - now.getTime() / 1000) / 60);
      return fmtIvl(c.due - today(col, now));
    };
    return { [Rating.Again]: f(Rating.Again), [Rating.Hard]: f(Rating.Hard), [Rating.Good]: f(Rating.Good), [Rating.Easy]: f(Rating.Easy) };
  },
};
