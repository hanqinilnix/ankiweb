// Reads an Anki SQLite collection (schema 11 JSON or schema 18 protobuf) into our model.
// Field mappings follow rslib/src/{decks,deckconfig,notetype}/schema11.rs and proto/anki/*.proto.
import type { Database } from 'sql.js';
import { rows } from './sqlite';
import { decode, f32, floats, int, str, sub, type PbMsg } from './proto';
import { emptyCommon, emptyNormal, LeechAction, NewGather, NewSort, ReviewMix, ReviewOrder, type Card, type CardType, type Collection, type DayLimit, type Deck, type DeckConfig, type Note, type NoteType, type Queue, type RevlogEntry } from '../model/types';

export interface Parsed {
  col: Collection; notetypes: NoteType[]; decks: Deck[]; dconf: DeckConfig[];
  notes: Note[]; cards: Card[]; revlog: RevlogEntry[];
}

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' ? Number(v) || d : typeof v === 'boolean' ? Number(v) : d);
const opt = (v: unknown) => (v === undefined || v === null ? undefined : num(v));
const json = (v: unknown) => JSON.parse(typeof v === 'string' ? v : new TextDecoder().decode(v as Uint8Array));
const bool = (v: unknown, d = false) => (v === undefined || v === null ? d : !!v);

export function readCollection(db: Database, schema: 11 | 18): Parsed {
  const col = rows(db, 'select * from col')[0]!;
  const s18 = schema === 18 || !!rows(db, "select name from sqlite_master where name='notetypes'").length;
  const cfg = s18 ? readConfig18(db) : (json(col.conf) as Record<string, unknown>);
  const base: Collection = {
    crt: num(col.crt), rollover: num(cfg.rollover, 4), fsrs: bool(cfg.fsrs),
    creationOffset: opt(cfg.creationOffset), learnAheadSecs: num(cfg.collapseTime, 1200),
    newCardsIgnoreReviewLimit: bool(cfg.newCardsIgnoreReviewLimit), applyAllParentLimits: bool(cfg.applyAllParentLimits),
    lastUnburiedDay: num(cfg.lastUnburied, 0),
  };
  const r = s18 ? read18(db) : read11(col);
  return { col: base, ...r, decks: fixDeckParents(r.decks), ...readRows(db) };
}

const dayLimit = (v: any): DayLimit | undefined => (v && typeof v === 'object' ? { limit: num(v.limit), today: num(v.today) } : undefined);

// ---- schema 11: JSON blobs in col ----
function read11(col: Record<string, unknown>) {
  const models = Object.values(json(col.models) as Record<string, any>);
  const notetypes: NoteType[] = models.map((m) => ({
    id: num(m.id), name: m.name, type: m.type === 1 ? 1 : 0, css: m.css ?? '',
    fields: m.flds.map((f: any) => ({ name: f.name, ord: f.ord, font: f.font, size: f.size })),
    templates: m.tmpls.map((t: any) => ({ name: t.name, ord: t.ord, qfmt: t.qfmt, afmt: t.afmt })),
  }));
  const decks: Deck[] = Object.values(json(col.decks) as Record<string, any>).filter((d) => !num(d.dyn)).map((d) => {
    const day = num(d.newToday?.[0]);
    return {
      id: num(d.id), name: d.name, confId: num(d.conf, 1),
      common: { lastDayStudied: day, newStudied: num(d.newToday?.[1]), reviewStudied: num(d.revToday?.[1]), learningStudied: num(d.lrnToday?.[1]), msStudied: num(d.timeToday?.[1]) },
      normal: { extendNew: Math.max(0, num(d.extendNew)), extendReview: Math.max(0, num(d.extendRev)), reviewLimit: opt(d.reviewLimit), newLimit: opt(d.newLimit), reviewLimitToday: dayLimit(d.reviewLimitToday), newLimitToday: dayLimit(d.newLimitToday) },
    };
  });
  const dconf: DeckConfig[] = Object.values(json(col.dconf) as Record<string, any>).map((c) => ({
    id: num(c.id), name: c.name,
    newPerDay: num(c.new?.perDay, 20), revPerDay: num(c.rev?.perDay, 200),
    learnSteps: c.new?.delays ?? [1, 10], relearnSteps: c.lapse?.delays ?? [10],
    graduatingIvl: num(c.new?.ints?.[0], 1), easyIvl: num(c.new?.ints?.[1], 4),
    startEase: num(c.new?.initialFactor, 2500) / 1000, maxIvl: num(c.rev?.maxIvl, 36500),
    hardMult: num(c.rev?.hardFactor, 1.2), easyMult: num(c.rev?.ease4, 1.3), lapseMult: num(c.lapse?.mult, 0), ivlMult: num(c.rev?.ivlFct, 1),
    minLapseIvl: num(c.lapse?.minInt, 1), leechThreshold: num(c.lapse?.leechFails, 8),
    leechAction: num(c.lapse?.leechAction, 1) as LeechAction, capAnswerSecs: Math.max(0, num(c.maxTaken, 60)),
    buryNew: bool(c.new?.bury), buryReviews: bool(c.rev?.bury), buryInterdayLearning: bool(c.buryInterdayLearning),
    newGather: num(c.newGatherPriority) as NewGather, newSort: num(c.newSortOrder) as NewSort, reviewOrder: num(c.reviewOrder) as ReviewOrder,
    newMix: num(c.newMix) as ReviewMix, interdayMix: num(c.interdayLearningMix) as ReviewMix,
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
const pbDayLimit = (m: PbMsg, f: number): DayLimit | undefined => { const s = m.get(f)?.[0]; return s instanceof Uint8Array ? { limit: int(sub(m, f), 1), today: int(sub(m, f), 2) } : undefined; };
const pbOpt = (m: PbMsg, f: number) => (m.has(f) ? int(m, f) : undefined);

function read18(db: Database) {
  const fields = new Map<number, NoteType['fields']>();
  for (const f of rows<{ ntid: number; ord: number; name: string; config: Uint8Array }>(db, 'select ntid, ord, name, config from fields order by ord')) {
    const c = decode(f.config);
    (fields.get(f.ntid) ?? fields.set(f.ntid, []).get(f.ntid)!).push({ name: f.name, ord: f.ord, font: str(c, 3) || undefined, size: int(c, 4) || undefined });
  }
  const tmpls = new Map<number, NoteType['templates']>();
  for (const t of rows<{ ntid: number; ord: number; name: string; config: Uint8Array }>(db, 'select ntid, ord, name, config from templates order by ord')) {
    const c = decode(t.config);
    (tmpls.get(t.ntid) ?? tmpls.set(t.ntid, []).get(t.ntid)!).push({ name: t.name, ord: t.ord, qfmt: str(c, 1), afmt: str(c, 2) });
  }
  const notetypes: NoteType[] = rows<{ id: number; name: string; config: Uint8Array }>(db, 'select id, name, config from notetypes').map((n) => {
    const c = decode(n.config);
    return { id: n.id, name: n.name, type: int(c, 1) === 1 ? 1 : 0, css: str(c, 3), fields: fields.get(n.id) ?? [], templates: tmpls.get(n.id) ?? [] };
  });
  const decks: Deck[] = [];
  for (const d of rows<{ id: number; name: string; common: Uint8Array; kind: Uint8Array }>(db, 'select id, name, common, kind from decks')) {
    const k = decode(d.kind);
    if (!k.has(1)) continue; // filtered deck
    const n = sub(k, 1), c = decode(d.common);
    decks.push({
      id: d.id, name: d.name.replaceAll('\x1f', '::'), confId: int(n, 1, 1),
      common: { lastDayStudied: int(c, 3), newStudied: int(c, 4), reviewStudied: int(c, 5), learningStudied: int(c, 6), msStudied: int(c, 7) },
      normal: { extendNew: int(n, 2), extendReview: int(n, 3), reviewLimit: pbOpt(n, 6), newLimit: pbOpt(n, 7), reviewLimitToday: pbDayLimit(n, 8), newLimitToday: pbDayLimit(n, 9) },
    });
  }
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
      leechAction: int(c, 21, 0) as LeechAction, capAnswerSecs: int(c, 24, 60),
      buryNew: !!int(c, 27), buryReviews: !!int(c, 28), buryInterdayLearning: !!int(c, 29),
      newGather: int(c, 34) as NewGather, newSort: int(c, 32) as NewSort, reviewOrder: int(c, 33) as ReviewOrder,
      newMix: int(c, 30) as ReviewMix, interdayMix: int(c, 31) as ReviewMix,
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
    return { ...d, common: d.common ?? emptyCommon(), normal: d.normal ?? emptyNormal(), ...(parentId && { parentId }) };
  });
}

// ---- notes / cards / revlog: same in both schemas ----
function readRows(db: Database) {
  const notes: Note[] = rows<any>(db, 'select id, guid, mid, mod, tags, flds from notes').map((n) => ({
    id: num(n.id), guid: n.guid, mid: num(n.mid), mod: num(n.mod),
    tags: String(n.tags).split(' ').filter(Boolean), fields: String(n.flds).split('\x1f'),
  }));
  const cards: Card[] = rows<any>(db, 'select id, nid, did, ord, mod, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data from cards').map((c) => {
    let fsrs: Card['fsrs'];
    try {
      const d = c.data && JSON.parse(c.data);
      if (d && typeof d.s === 'number' && typeof d.d === 'number') fsrs = { s: d.s, d: d.d };
    } catch { /* not JSON */ }
    return {
      id: num(c.id), nid: num(c.nid), did: num(c.did), ord: num(c.ord), mod: num(c.mod),
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
