import { openPackage } from './apkg';
import { openDb } from './sqlite';
import { readCollection, type Parsed } from './collection';
import { getDB } from '../store/db';

export interface Progress { stage: 'unzip' | 'read' | 'notes' | 'cards' | 'media' | 'done'; done?: number; total?: number }
type OnProgress = (p: Progress) => void;

export async function parsePackage(bytes: Uint8Array, locateFile?: (f: string) => string) {
  const pkg = openPackage(bytes);
  const db = await openDb(pkg.collection, locateFile);
  try { return { parsed: readCollection(db, pkg.schema), pkg }; } finally { db.close(); }
}

export async function importPackage(bytes: Uint8Array, onProgress: OnProgress = () => {}, locateFile?: (f: string) => string) {
  onProgress({ stage: 'unzip' });
  const { parsed, pkg } = await parsePackage(bytes, locateFile);
  onProgress({ stage: 'read' });
  await writeParsed(parsed, onProgress);
  const db = await getDB();
  let i = 0;
  for (const [key, name] of pkg.media) {
    const bytes = pkg.zip[key];
    if (bytes) await db.put('media', { name, blob: new Blob([bytes as BlobPart]) });
    if (++i % 25 === 0) onProgress({ stage: 'media', done: i, total: pkg.media.size });
  }
  onProgress({ stage: 'done' });
  return { notes: parsed.notes.length, cards: parsed.cards.length, media: pkg.media.size };
}

// Merge: notes by guid, cards by (nid, ord). Incoming card wins only if it has more reps.
export async function writeParsed(p: Parsed, onProgress: OnProgress = () => {}) {
  const db = await getDB();
  const tx = db.transaction(['col', 'notetypes', 'decks', 'dconf', 'notes', 'cards', 'revlog'], 'readwrite');
  if (!(await tx.objectStore('col').get('col'))) await tx.objectStore('col').put(p.col, 'col');
  for (const n of p.notetypes) await tx.objectStore('notetypes').put(n);
  for (const d of p.decks) { const ex = await tx.objectStore('decks').get(d.id); await tx.objectStore('decks').put(ex ? { ...d, common: ex.common, normal: ex.normal } : d); }
  for (const c of p.dconf) await tx.objectStore('dconf').put(c);

  const notes = tx.objectStore('notes'), cards = tx.objectStore('cards'), revlog = tx.objectStore('revlog');
  const nidMap = new Map<number, number>();
  let i = 0;
  for (const n of p.notes) {
    const ex = await notes.index('guid').get(n.guid);
    if (ex) { nidMap.set(n.id, ex.id); if (n.mod > ex.mod) await notes.put({ ...n, id: ex.id }); }
    else { nidMap.set(n.id, n.id); await notes.put(n); }
    if (++i % 500 === 0) onProgress({ stage: 'notes', done: i, total: p.notes.length });
  }
  const cidMap = new Map<number, number>();
  i = 0;
  for (const c of p.cards) {
    const nid = nidMap.get(c.nid) ?? c.nid;
    const ex = (await cards.index('nid').getAll(nid)).find((x) => x.ord === c.ord);
    if (ex) { cidMap.set(c.id, ex.id); if (c.reps > ex.reps) await cards.put({ ...c, id: ex.id, nid }); }
    else { cidMap.set(c.id, c.id); await cards.put({ ...c, nid }); }
    if (++i % 500 === 0) onProgress({ stage: 'cards', done: i, total: p.cards.length });
  }
  for (const r of p.revlog) {
    if (!(await revlog.get(r.id))) await revlog.put({ ...r, cid: cidMap.get(r.cid) ?? r.cid });
  }
  await tx.done;
}
