import type { Database } from 'sql.js';
import { rows } from './sqlite';
import { decode, f32, floats, int, str, sub } from './proto';
import type { Card, CardType, Collection, Deck, DeckConfig, Note, NoteType, Queue, RevlogEntry } from '../model/types';

export interface Parsed {
  col: Collection; notetypes: NoteType[]; decks: Deck[]; dconf: DeckConfig[];
  notes: Note[]; cards: Card[]; revlog: RevlogEntry[];
}

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' ? Number(v) || d : d);
const json = (v: unknown) => JSON.parse(typeof v === 'string' ? v : new TextDecoder().decode(v as Uint8Array));

export function readCollection(db: Database, schema: 11 | 18): Parsed {
  const col = rows(db, 'select * from col')[0]!;
  const crt = num(col.crt);
  const s18 = schema === 18 || !!rows(db, "select name from sqlite_master where name='notetypes'").length;
  const cfg = s18 ? readConfig18(db) : (json(col.conf) as Record<string, unknown>);
  const base = { crt, rollover: num(cfg.rollover, 4), fsrs: !!cfg.fsrs };
  const r = s18 ? read18(db) : read11(col);
  return { col: base, ...r, decks: fixDeckParents(r.decks), ...readRows(db) };
}

// ---- schema 11: JSON blobs in col ----
function read11(col: Record<string, unknown>) {
  const models = Object.values(json(col.models) as Record<string, any>);
  const notetypes: NoteType[] = models.map((m) => ({
    id: num(m.id), name: m.name, type: m.type === 1 ? 1 : 0, css: m.css ?? '',
    fields: m.flds.map((f: any) => ({ name: f.name, ord: f.ord })),
    templates: m.tmpls.map((t: any) => ({ name: t.name, ord: t.ord, qfmt: t.qfmt, afmt: t.afmt })),
  }));
  const decks: Deck[] = Object.values(json(col.decks) as Record<string, any>).map((d) => ({
    id: num(d.id), name: d.name, confId: num(d.conf, 1),
  }));
  const dconf: DeckConfig[] = Object.values(json(col.dconf) as Record<string, any>).map((c) => ({
    id: num(c.id), name: c.name,
    newPerDay: num(c.new?.perDay, 20), revPerDay: num(c.rev?.perDay, 200),
    learnSteps: c.new?.delays ?? [1, 10], relearnSteps: c.lapse?.delays ?? [10],
    graduatingIvl: num(c.new?.ints?.[0], 1), easyIvl: num(c.new?.ints?.[1], 4),
    startEase: num(c.new?.initialFactor, 2500) / 1000, maxIvl: num(c.rev?.maxIvl, 36500),
    hardMult: num(c.rev?.hardFactor, 1.2), easyMult: num(c.rev?.ease4, 1.3), lapseMult: num(c.lapse?.mult, 0), ivlMult: num(c.rev?.ivlFct, 1),
    minLapseIvl: num(c.lapse?.minInt, 1), leechThreshold: num(c.lapse?.leechFails, 8),
    fsrs: false, fsrsParams: c.fsrsParams6 ?? c.fsrsParams5 ?? c.fsrsWeights ?? [], desiredRetention: num(c.desiredRetention, 0.9),
  }));
  return { notetypes, decks, dconf };
}

// ---- schema 18: protobuf blobs in tables ----
function readConfig18(db: Database): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows<{ KEY: string; val: Uint8Array }>(db, 'select KEY, val from config')) {
    try { out[r.KEY] = json(r.val); } catch { /* non-JSON value */ }
  }
  return out;
}

function read18(db: Database) {
  const fields = new Map<number, NoteType['fields']>();
  for (const f of rows<{ ntid: number; ord: number; name: string }>(db, 'select ntid, ord, name from fields order by ord'))
    (fields.get(f.ntid) ?? fields.set(f.ntid, []).get(f.ntid)!).push({ name: f.name, ord: f.ord });
  const tmpls = new Map<number, NoteType['templates']>();
  for (const t of rows<{ ntid: number; ord: number; name: string; config: Uint8Array }>(db, 'select ntid, ord, name, config from templates order by ord')) {
    const c = decode(t.config);
    (tmpls.get(t.ntid) ?? tmpls.set(t.ntid, []).get(t.ntid)!).push({ name: t.name, ord: t.ord, qfmt: str(c, 1), afmt: str(c, 2) });
  }
  const notetypes: NoteType[] = rows<{ id: number; name: string; config: Uint8Array }>(db, 'select id, name, config from notetypes').map((n) => {
    const c = decode(n.config);
    return { id: n.id, name: n.name, type: int(c, 1) === 1 ? 1 : 0, css: str(c, 3), fields: fields.get(n.id) ?? [], templates: tmpls.get(n.id) ?? [] };
  });
  const decks: Deck[] = rows<{ id: number; name: string; kind: Uint8Array }>(db, 'select id, name, kind from decks').map((d) => ({
    id: d.id, name: d.name.replaceAll('\x1f', '::'), confId: int(sub(decode(d.kind), 1), 1, 1),
  }));
  const dconf: DeckConfig[] = rows<{ id: number; name: string; config: Uint8Array }>(db, 'select id, name, config from deck_config').map((r) => {
    const c = decode(r.config);
    const p = [6, 5, 3].map((f) => floats(c, f)).find((a) => a.length) ?? [];
    return {
      id: r.id, name: r.name,
      newPerDay: int(c, 9, 20), revPerDay: int(c, 10, 200),
      learnSteps: floats(c, 1), relearnSteps: floats(c, 2),
      graduatingIvl: int(c, 18, 1), easyIvl: int(c, 19, 4),
      startEase: f32(c, 11, 2.5), maxIvl: int(c, 16, 36500),
      hardMult: f32(c, 13, 1.2), easyMult: f32(c, 12, 1.3), lapseMult: f32(c, 14, 0), ivlMult: f32(c, 15, 1),
      minLapseIvl: int(c, 17, 1), leechThreshold: int(c, 22, 8),
      fsrs: false, fsrsParams: p, desiredRetention: f32(c, 37, 0.9),
    };
  });
  return { notetypes, decks, dconf };
}

function fixDeckParents(decks: Deck[]): Deck[] {
  const byName = new Map(decks.map((d) => [d.name, d.id]));
  return decks.map((d) => {
    const i = d.name.lastIndexOf('::');
    const parentId = i > 0 ? byName.get(d.name.slice(0, i)) : undefined;
    return parentId ? { ...d, parentId } : d;
  });
}

// ---- notes / cards / revlog: same in both schemas ----
function readRows(db: Database) {
  const notes: Note[] = rows<any>(db, 'select id, guid, mid, mod, tags, flds from notes').map((n) => ({
    id: num(n.id), guid: n.guid, mid: num(n.mid), mod: num(n.mod),
    tags: String(n.tags).split(' ').filter(Boolean), fields: String(n.flds).split('\x1f'),
  }));
  const cards: Card[] = rows<any>(db, 'select id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data from cards').map((c) => {
    let fsrs: Card['fsrs'];
    try {
      const d = c.data && JSON.parse(c.data);
      if (d && typeof d.s === 'number' && typeof d.d === 'number') fsrs = { s: d.s, d: d.d };
    } catch { /* not JSON */ }
    return {
      id: num(c.id), nid: num(c.nid), did: num(c.did), ord: num(c.ord),
      type: num(c.type) as CardType, queue: num(c.queue) as Queue, due: num(c.due),
      ivl: num(c.ivl), factor: num(c.factor), reps: num(c.reps), lapses: num(c.lapses), left: num(c.left),
      odue: num(c.odue), odid: num(c.odid), flags: num(c.flags), ...(fsrs && { fsrs }),
    };
  });
  const revlog: RevlogEntry[] = rows<any>(db, 'select id, cid, ease, ivl, lastIvl, factor, time, type from revlog').map((r) => ({
    id: num(r.id), cid: num(r.cid), ease: num(r.ease), ivl: num(r.ivl), lastIvl: num(r.lastIvl), factor: num(r.factor), time: num(r.time), type: num(r.type),
  }));
  return { notes, cards, revlog };
}
