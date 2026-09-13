// Collection-level operations: ports of rslib deck tree counts, queue fetching, answering side effects,
// bury/unbury, custom study limit extension, congrats info. IO lives here; scheduler/ stays pure.
import { CardType, Queue, Rating, type Card, type Collection, type Deck, type DeckConfig, type Note, type NoteType } from '../model/types';
import { activeDecks, answerCard, anyBurying, applyStats, buildQueues, buryModeOf, describeNextStates, extendDelta, makeUpdater, nextEntry, popEntry, remainingLimits, requeueLearning, statsDelta, timingFor, type CardQueues, type SchedTimingToday, type Updater } from '../scheduler';
import { capTo, type RemainingLimits } from '../scheduler/limits';
import { getDB } from './db';

export const loadCol = async (): Promise<Collection | undefined> => (await getDB()).get('col', 'col');
const saveCol = async (col: Collection) => (await getDB()).put('col', col, 'col');

// ---- deck tree (rslib/src/decks/tree.rs + storage/deck/due_counts.sql) ----
export interface DeckRow extends Deck { newCount: number; learnCount: number; reviewCount: number; depth: number }
interface DueCounts { new: number; review: number; interday: number; intraday: number }

export async function deckTree(col: Collection, now: Date): Promise<DeckRow[]> {
  const db = await getDB();
  await unburyIfDayRolledOver(col, timingFor(col, now));
  const timing = timingFor(col, now);
  const learnCutoff = timing.now + col.learnAheadSecs;
  const decks = (await db.getAll('decks')).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const cfgs = new Map((await db.getAll('dconf')).map((c) => [c.id, c]));
  const counts = new Map<number, DueCounts>();
  for (const c of await db.getAll('cards')) {
    const k = counts.get(c.did) ?? counts.set(c.did, { new: 0, review: 0, interday: 0, intraday: 0 }).get(c.did)!;
    if (c.queue === Queue.New) k.new++;
    else if (c.queue === Queue.Review && c.due <= timing.daysElapsed) k.review++;
    else if (c.queue === Queue.DayLearn && c.due <= timing.daysElapsed) k.interday++;
    else if ((c.queue === Queue.Learn && c.due < learnCutoff) || (c.queue === Queue.Preview && c.due <= learnCutoff)) k.intraday++;
  }
  const limits = new Map(decks.map((d) => [d.id, remainingLimits(d, cfgs.get(d.confId), timing.daysElapsed, col.newCardsIgnoreReviewLimit)]));
  // sum_counts_and_apply_limits_v3 over the name-sorted list (children follow parents)
  const rows: DeckRow[] = [];
  const level = (d: Deck) => d.name.split('::').length;
  const visit = (i: number, parentLimits?: RemainingLimits): [DueCounts, number] => {
    const d = decks[i]!;
    let remaining = limits.get(d.id)!;
    if (parentLimits) remaining = capTo(remaining, parentLimits);
    const own = counts.get(d.id) ?? { new: 0, review: 0, interday: 0, intraday: 0 };
    const total = { ...own };
    let j = i + 1;
    while (j < decks.length && level(decks[j]!) > level(d)) {
      const [c, next] = visit(j, parentLimits ? remaining : undefined);
      total.new += c.new; total.review += c.review; total.interday += c.interday; total.intraday += c.intraday;
      j = next;
    }
    const capped = { ...total, new: Math.min(total.new, remaining.new), review: Math.min(total.review, remaining.review), interday: Math.min(total.interday, remaining.review) };
    rows.push({ ...d, depth: level(d) - 1, newCount: capped.new, reviewCount: capped.review, learnCount: capped.intraday + capped.interday });
    return [capped, j];
  };
  for (let i = 0; i < decks.length;) [, i] = visit(i, undefined);
  // apply_limits_v3 passes parent limits to children; redo with capping from each root
  return rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---- queues ----
let queues: { deckId: number; q: CardQueues } | undefined;
export const clearQueues = () => { queues = undefined; };

async function subtreeCards(deckIds: Set<number>): Promise<Card[]> {
  const db = await getDB();
  const out: Card[] = [];
  for (const id of deckIds) out.push(...(await db.getAllFromIndex('cards', 'did', id)));
  return out;
}

async function getQueues(deckId: number, col: Collection, now: Date): Promise<CardQueues> {
  const timing = timingFor(col, now);
  if (queues && queues.deckId === deckId && queues.q.currentDay === timing.daysElapsed) return queues.q;
  await unburyIfDayRolledOver(col, timing);
  const db = await getDB();
  const decks = await db.getAll('decks');
  const cfgs = new Map((await db.getAll('dconf')).map((c) => [c.id, c]));
  const ids = new Set(activeDecks(decks, deckId).map((d) => d.id));
  const q = buildQueues({ col, timing, rootId: deckId, decks, cfgs, cards: await subtreeCards(ids), now });
  queues = { deckId, q };
  return q;
}

export interface Next { card: Card; note: Note; notetype: NoteType; deck: Deck; cfg: DeckConfig; updater: Updater; counts: CardQueues['counts']; kind: 'new' | 'learning' | 'review' }

async function lastReviewSecs(cid: number): Promise<number | undefined> {
  const logs = await (await getDB()).getAllFromIndex('revlog', 'cid', cid);
  const last = logs.reduce((m, r) => (r.type !== 4 && r.id > m ? r.id : m), 0);
  return last ? Math.floor(last / 1000) : undefined;
}

export async function nextCard(deckId: number, col: Collection, now: Date): Promise<Next | undefined> {
  const q = await getQueues(deckId, col, now);
  const e = nextEntry(q, Math.floor(now.getTime() / 1000));
  if (!e) return;
  const db = await getDB();
  const card = await db.get('cards', e.id);
  if (!card) { popEntry(q, e.id); return nextCard(deckId, col, now); }
  const note = (await db.get('notes', card.nid))!;
  const notetype = (await db.get('notetypes', note.mid))!;
  const deck = (await db.get('decks', card.did))!;
  const home = card.odid ? (await db.get('decks', card.odid)) ?? deck : deck;
  const cfg = (await db.get('dconf', home.confId)) ?? (await db.getAll('dconf'))[0]!;
  const updater = makeUpdater(card, deck, cfg, col, timingFor(col, now), now, await lastReviewSecs(card.id));
  return { card, note, notetype, deck, cfg, updater, counts: { ...q.counts }, kind: e.kind };
}

export const describe = (n: Next, col: Collection) => describeNextStates(n.updater, col.learnAheadSecs);

async function updateDeckStats(deckId: number, today: number, f: Parameters<typeof applyStats>[2], parentsToo: boolean) {
  const db = await getDB();
  const decks = await db.getAll('decks');
  const d = decks.find((x) => x.id === deckId);
  if (!d) return;
  const targets = parentsToo ? decks.filter((x) => x.id === d.id || d.name.startsWith(x.name + '::')) : [d];
  const tx = db.transaction('decks', 'readwrite');
  for (const t of targets) await tx.store.put(applyStats(t, today, f));
  await tx.done;
}

export async function answer(n: Next, rating: Rating, col: Collection, now: Date, elapsedMs: number) {
  const timing = n.updater.timing;
  const r = answerCard(n.updater, rating, now.getTime(), elapsedMs);
  const db = await getDB();
  const tx = db.transaction(['cards', 'revlog'], 'readwrite');
  await tx.objectStore('cards').put(r.card);
  await tx.objectStore('revlog').put(r.revlog);
  await tx.done;
  await updateDeckStats(n.deck.id, timing.daysElapsed, statsDelta(r.newDelta, r.reviewDelta, r.revlog.time), true);
  const mode = buryModeOf(n.cfg);
  if (anyBurying(mode)) await burySiblings(n.card, mode);
  if (queues) { popEntry(queues.q, r.card.id); requeueLearning(queues.q, r.card, timing, Math.floor(now.getTime() / 1000)); }
  return r.card;
}

// bury_and_suspend.rs bury_siblings
async function burySiblings(card: Card, mode: ReturnType<typeof buryModeOf>) {
  const ord = (q: Queue) => (q === Queue.Learn || q === Queue.Preview ? 0 : q === Queue.DayLearn ? 1 : q === Queue.Review ? 2 : q === Queue.New ? 3 : 255);
  const m = { ...mode, buryInterdayLearning: mode.buryInterdayLearning && ord(card.queue) <= 1, buryReviews: mode.buryReviews && ord(card.queue) <= 2 };
  const db = await getDB();
  const sibs = (await db.getAllFromIndex('cards', 'nid', card.nid)).filter((c) => c.id !== card.id &&
    ((m.buryNew && c.queue === Queue.New) || (m.buryReviews && c.queue === Queue.Review) || (m.buryInterdayLearning && c.queue === Queue.DayLearn)));
  const tx = db.transaction('cards', 'readwrite');
  for (const c of sibs) { await tx.store.put({ ...c, queue: Queue.SchedBuried }); if (queues) popFromMain(queues.q, c.id); }
  await tx.done;
}
const popFromMain = (q: CardQueues, id: number) => { const i = q.main.findIndex((e) => e.id === id); if (i >= 0) { const [e] = q.main.splice(i, 1); if (e!.kind === 'new') q.counts.new--; else if (e!.kind === 'review') q.counts.review--; else q.counts.learning--; } };

export async function setQueue(cardId: number, queue: Queue) {
  const db = await getDB();
  const c = await db.get('cards', cardId);
  if (c && c.queue !== Queue.Suspended) { await db.put('cards', { ...c, queue }); if (queues) { popEntry(queues.q, cardId); popFromMain(queues.q, cardId); } }
}

// restore_queue_from_type
const restoreQueue = (c: Card): Card => ({ ...c, queue: c.type === CardType.New ? Queue.New : c.type === CardType.Review ? Queue.Review : c.due > 1_000_000_000 ? Queue.Learn : Queue.DayLearn });
export async function unburyIfDayRolledOver(col: Collection, timing: SchedTimingToday) {
  const today = timing.daysElapsed;
  if (col.lastUnburiedDay < today || today + 7 < col.lastUnburiedDay) {
    const db = await getDB();
    const tx = db.transaction('cards', 'readwrite');
    for (const c of await tx.store.getAll()) if (c.queue === Queue.SchedBuried || c.queue === Queue.UserBuried) await tx.store.put(restoreQueue(c));
    await tx.done;
    col.lastUnburiedDay = today;
    await saveCol(col);
    clearQueues();
  }
}
export async function unburyDeck(deckId: number) {
  const db = await getDB();
  const ids = new Set(activeDecks(await db.getAll('decks'), deckId).map((d) => d.id));
  const tx = db.transaction('cards', 'readwrite');
  for (const c of await tx.store.getAll()) if (ids.has(c.did) && (c.queue === Queue.SchedBuried || c.queue === Queue.UserBuried)) await tx.store.put(restoreQueue(c));
  await tx.done;
  clearQueues();
}

// custom_study.rs NewLimitDelta / ReviewLimitDelta
export async function extendLimits(deckId: number, col: Collection, now: Date, newDelta: number, reviewDelta: number) {
  const today = timingFor(col, now).daysElapsed;
  await updateDeckStats(deckId, today, extendDelta(newDelta, reviewDelta), col.applyAllParentLimits);
  const db = await getDB();
  const d = await db.get('decks', deckId);
  if (d) await db.put('decks', { ...d, normal: { ...d.normal, ...(newDelta > 0 && { extendNew: newDelta }), ...(reviewDelta > 0 && { extendReview: reviewDelta }) } });
  clearQueues();
}

// congrats.rs
export interface Congrats { learnRemaining: number; secsUntilNextLearn: number; reviewRemaining: boolean; newRemaining: boolean; haveSchedBuried: boolean; haveUserBuried: boolean }
export async function congratsInfo(deckId: number, col: Collection, now: Date): Promise<Congrats> {
  const timing = timingFor(col, now);
  const db = await getDB();
  const ids = new Set(activeDecks(await db.getAll('decks'), deckId).map((d) => d.id));
  const cards = await subtreeCards(ids);
  const learn = cards.filter((c) => c.queue === Queue.Learn);
  const nextLearn = learn.length ? Math.min(...learn.map((c) => c.due)) : 0;
  return {
    learnRemaining: learn.length,
    secsUntilNextLearn: nextLearn === 0 ? 86400 : Math.max(60, nextLearn - col.learnAheadSecs - timing.now),
    reviewRemaining: cards.some((c) => (c.queue === Queue.Review || c.queue === Queue.DayLearn) && c.due <= timing.daysElapsed),
    newRemaining: cards.some((c) => c.queue === Queue.New),
    haveSchedBuried: cards.some((c) => c.queue === Queue.SchedBuried), haveUserBuried: cards.some((c) => c.queue === Queue.UserBuried),
  };
}

const urlCache = new Map<string, string>();
export async function mediaUrl(name: string): Promise<string | undefined> {
  const hit = urlCache.get(name);
  if (hit) return hit;
  const m = await (await getDB()).get('media', name);
  if (!m) return;
  const u = URL.createObjectURL(m.blob);
  urlCache.set(name, u);
  return u;
}
