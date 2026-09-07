import { fsrs as mk, generatorParameters, State, type Card as FCard, type Grade } from 'ts-fsrs';
import { CardType, Queue, Rating, type Card, type Collection, type DeckConfig } from '../model/types';
import { dayToDate, fmtIvl, revlogFor, today, type Scheduler } from './index';

const engine = (cfg: DeckConfig) =>
  mk(generatorParameters({
    w: cfg.fsrsParams, request_retention: cfg.desiredRetention, maximum_interval: cfg.maxIvl,
    enable_fuzz: false, enable_short_term: true,
    learning_steps: cfg.learnSteps.map((m) => `${m}m` as const), relearning_steps: cfg.relearnSteps.map((m) => `${m}m` as const),
  }));

function toF(c: Card, cfg: DeckConfig, col: Collection, now: Date): FCard {
  const steps = c.type === CardType.Relearn ? cfg.relearnSteps : cfg.learnSteps;
  const review = c.type === CardType.Review;
  const due = c.type === CardType.New ? now : review || c.queue === Queue.DayLearn ? dayToDate(col, c.due) : new Date(c.due * 1000);
  const last = review ? dayToDate(col, c.due - c.ivl) : undefined;
  return {
    due, stability: c.fsrs?.s ?? 0, difficulty: c.fsrs?.d ?? 0,
    elapsed_days: last ? Math.max(0, today(col, now) - (c.due - c.ivl)) : 0, scheduled_days: review ? c.ivl : 0,
    learning_steps: c.type === CardType.New || review ? 0 : Math.max(0, steps.length - c.left), reps: c.reps, lapses: c.lapses,
    state: c.type as unknown as State, last_review: last,
  };
}

function fromF(c: Card, f: FCard, cfg: DeckConfig, col: Collection, now: Date): Card {
  const type = f.state as unknown as CardType;
  const review = type === CardType.Review;
  const dueSec = Math.floor(f.due.getTime() / 1000);
  const dayLearn = !review && dueSec - now.getTime() / 1000 >= 86400;
  return {
    ...c, type, reps: f.reps, lapses: f.lapses, left: review ? 0 : Math.max(1, (type === CardType.Relearn ? cfg.relearnSteps : cfg.learnSteps).length - f.learning_steps),
    queue: review ? Queue.Review : dayLearn ? Queue.DayLearn : Queue.Learn,
    ivl: review ? f.scheduled_days : c.ivl,
    due: review || dayLearn ? today(col, now) + Math.max(1, Math.round((f.due.getTime() - now.getTime()) / 86400000)) : dueSec,
    fsrs: { s: f.stability, d: f.difficulty },
  };
}

export const fsrs: Scheduler = {
  answer(card, rating, cfg, col, now, elapsedMs) {
    const { card: f } = engine(cfg).next(toF(card, cfg, col, now), now, rating as unknown as Grade);
    const nc = fromF(card, f, cfg, col, now);
    return { card: nc, revlog: revlogFor(nc, card, rating, now, elapsedMs) };
  },
  preview(card, cfg, col, now) {
    const e = engine(cfg), f = toF(card, cfg, col, now);
    const p = (r: Rating) => {
      const mins = (e.next(f, now, r as unknown as Grade).card.due.getTime() - now.getTime()) / 60000;
      return fmtIvl(mins / 1440, mins);
    };
    return { [Rating.Again]: p(Rating.Again), [Rating.Hard]: p(Rating.Hard), [Rating.Good]: p(Rating.Good), [Rating.Easy]: p(Rating.Easy) };
  },
};
