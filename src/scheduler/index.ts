import { CardType, Queue, type Card, type Collection, type DeckConfig, type Rating, type RevlogEntry } from '../model/types';
import { sm2 } from './sm2';
import { fsrs } from './fsrs';

export interface Answer { card: Card; revlog: RevlogEntry }
export interface Scheduler {
  answer(card: Card, rating: Rating, cfg: DeckConfig, col: Collection, now: Date, elapsedMs: number): Answer;
  preview(card: Card, cfg: DeckConfig, col: Collection, now: Date): Record<Rating, string>;
}

export const pick = (cfg: DeckConfig, col: Collection): Scheduler => (col.fsrs && cfg.fsrsParams.length ? fsrs : sm2);

// Day index since collection creation. crt already sits at the rollover hour.
export const today = (col: Collection, now: Date) => Math.floor((now.getTime() / 1000 - col.crt) / 86400);
export const dayToDate = (col: Collection, day: number) => new Date((col.crt + day * 86400) * 1000);

export function isDue(c: Card, col: Collection, now: Date): boolean {
  if (c.queue === Queue.New) return true;
  if (c.queue === Queue.Learn || c.queue === Queue.Preview) return c.due <= now.getTime() / 1000;
  if (c.queue === Queue.Review || c.queue === Queue.DayLearn) return c.due <= today(col, now);
  return false;
}

export const fmtIvl = (days: number, mins?: number) =>
  mins !== undefined && mins < 60 ? `${Math.round(mins)}m`
  : mins !== undefined && mins < 1440 ? `${Math.round(mins / 60)}h`
  : days < 30 ? `${Math.round(days)}d` : days < 365 ? `${(days / 30).toFixed(1)}mo` : `${(days / 365).toFixed(1)}y`;

export const revlogFor = (card: Card, before: Card, rating: Rating, now: Date, elapsedMs: number): RevlogEntry => ({
  id: now.getTime(), cid: card.id, ease: rating,
  ivl: card.type === CardType.Review ? card.ivl : -Math.max(1, card.due - now.getTime() / 1000),
  lastIvl: before.ivl, factor: card.factor, time: Math.min(elapsedMs, 60_000),
  type: before.type === CardType.New || before.type === CardType.Learn ? 0 : before.type === CardType.Review ? 1 : 2,
});
