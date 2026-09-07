import { CardType, Queue, type Card, type Collection, type Deck, type DeckConfig, type Note, type NoteType, type Rating } from '../model/types';
import { isDue, pick, today } from '../scheduler';
import { getDB } from './db';

export interface DeckRow extends Deck { newCount: number; learnCount: number; reviewCount: number; depth: number }

export async function loadCol(): Promise<Collection | undefined> {
  return (await getDB()).get('col', 'col');
}

// Deck and all descendants, by name prefix.
async function subtree(deckId: number): Promise<Deck[]> {
  const decks = await (await getDB()).getAll('decks');
  const root = decks.find((d) => d.id === deckId);
  if (!root) return [];
  return decks.filter((d) => d.id === deckId || d.name.startsWith(root.name + '::'));
}

async function newStudiedToday(col: Collection, now: Date, deckIds: Set<number>): Promise<number> {
  const db = await getDB();
  const start = (col.crt + today(col, now) * 86400) * 1000;
  const logs = await db.getAll('revlog', IDBKeyRange.lowerBound(start));
  let n = 0;
  for (const l of logs) if (l.type === 0 && l.lastIvl === 0) { const c = await db.get('cards', l.cid); if (c && deckIds.has(c.did)) n++; }
  return n;
}

export async function deckRows(col: Collection, now: Date): Promise<DeckRow[]> {
  const db = await getDB();
  const decks = (await db.getAll('decks')).sort((a, b) => a.name.localeCompare(b.name));
  const cards = await db.getAll('cards');
  const dconf = new Map((await db.getAll('dconf')).map((c) => [c.id, c]));
  const rows: DeckRow[] = [];
  for (const d of decks) {
    const ids = new Set((await subtree(d.id)).map((x) => x.id));
    const cfg = dconf.get(d.confId);
    let n = 0, l = 0, r = 0;
    for (const c of cards) {
      if (!ids.has(c.did) || !isDue(c, col, now)) continue;
      if (c.queue === Queue.New) n++; else if (c.queue === Queue.Review) r++; else l++;
    }
    const studied = await newStudiedToday(col, now, ids);
    rows.push({ ...d, depth: d.name.split('::').length - 1, newCount: Math.min(n, Math.max(0, (cfg?.newPerDay ?? 20) - studied)), learnCount: l, reviewCount: Math.min(r, cfg?.revPerDay ?? 200) });
  }
  return rows;
}

export interface Next { card: Card; note: Note; notetype: NoteType; deck: Deck; cfg: DeckConfig }

export async function nextCard(deckId: number, col: Collection, now: Date): Promise<Next | undefined> {
  const db = await getDB();
  const decks = await subtree(deckId);
  const ids = new Set(decks.map((d) => d.id));
  const cards: Card[] = [];
  for (const id of ids) cards.push(...(await db.getAllFromIndex('cards', 'did', id)));
  const due = cards.filter((c) => isDue(c, col, now));
  const root = decks.find((d) => d.id === deckId)!;
  const cfg = (await db.get('dconf', root.confId)) ?? (await db.getAll('dconf'))[0]!;
  const learn = due.filter((c) => c.queue === Queue.Learn || c.queue === Queue.DayLearn).sort((a, b) => a.due - b.due);
  const review = due.filter((c) => c.queue === Queue.Review).sort((a, b) => a.due - b.due || a.id - b.id);
  const fresh = due.filter((c) => c.queue === Queue.New).sort((a, b) => a.due - b.due || a.id - b.id);
  const newLeft = cfg.newPerDay - (await newStudiedToday(col, now, ids));
  const card = learn[0] ?? review[0] ?? (newLeft > 0 ? fresh[0] : undefined);
  if (!card) return;
  const note = (await db.get('notes', card.nid))!;
  const notetype = (await db.get('notetypes', note.mid))!;
  const deck = decks.find((d) => d.id === card.did) ?? root;
  return { card, note, notetype, deck, cfg };
}

export async function answer(n: Next, rating: Rating, col: Collection, now: Date, elapsedMs: number) {
  const { card, revlog } = pick(n.cfg, col).answer(n.card, rating, n.cfg, col, now, elapsedMs);
  const db = await getDB();
  const tx = db.transaction(['cards', 'revlog'], 'readwrite');
  await tx.objectStore('cards').put(card);
  await tx.objectStore('revlog').put(revlog);
  await tx.done;
  return card;
}

export async function setQueue(cardId: number, queue: Queue) {
  const db = await getDB();
  const c = await db.get('cards', cardId);
  if (c) await db.put('cards', { ...c, queue });
}

export const isNew = (c: Card) => c.type === CardType.New;

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
