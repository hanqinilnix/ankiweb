// Builds small .apkg packages in memory for tests (schema 11 and 18).
import initSqlJs from 'sql.js';
import { zipSync } from 'fflate';
import { enc } from './proto-encode';

const te = new TextEncoder();
export const CRT = 1_700_000_000; // 2023-11-14 22:13 UTC

const basicModel = {
  id: 1, name: 'Basic', type: 0, css: '.card{font-size:20px}',
  flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }],
  tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' }],
};
const clozeModel = {
  id: 2, name: 'Cloze', type: 1, css: '.cloze{font-weight:bold;color:blue}',
  flds: [{ name: 'Text', ord: 0 }, { name: 'Extra', ord: 1 }],
  tmpls: [{ name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' }],
};
const dconf = { id: 1, name: 'Default', new: { perDay: 20, delays: [1, 10], ints: [1, 4], initialFactor: 2500 }, rev: { perDay: 200, maxIvl: 36500 }, lapse: { delays: [10] }, desiredRetention: 0.9 };

export const notes = [
  { id: 101, guid: 'g-basic-1', mid: 1, flds: 'Hello<img src="pic.png">\x1fWorld [sound:hi.mp3]', tags: ' t1 t2 ' },
  { id: 102, guid: 'g-cloze-1', mid: 2, flds: 'The {{c1::sky}} is {{c2::blue::colour}}\x1fextra', tags: '' },
];
export const cards = [
  { id: 201, nid: 101, did: 1, ord: 0, type: 0, queue: 0, due: 1, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, data: '' },
  { id: 202, nid: 102, did: 1, ord: 0, type: 2, queue: 2, due: 10, ivl: 5, factor: 2500, reps: 3, lapses: 0, left: 0, data: '{"s":4.2,"d":5.1}' },
  { id: 203, nid: 102, did: 1, ord: 1, type: 1, queue: 1, due: CRT + 100, ivl: 0, factor: 2500, reps: 1, lapses: 0, left: 1, data: '' },
];
const revlog = [{ id: 1_700_100_000_000, cid: 202, ease: 3, ivl: 5, lastIvl: 2, factor: 2500, time: 4000, type: 1 }];
export const media = { 'pic.png': te.encode('PNG'), 'hi.mp3': te.encode('MP3') };

const SCHEMA11 = `
create table col(id integer primary key,crt integer,mod integer,scm integer,ver integer,dty integer,usn integer,ls integer,conf text,models text,decks text,dconf text,tags text);
create table notes(id integer primary key,guid text,mid integer,mod integer,usn integer,tags text,flds text,sfld integer,csum integer,flags integer,data text);
create table cards(id integer primary key,nid integer,did integer,ord integer,mod integer,usn integer,type integer,queue integer,due integer,ivl integer,factor integer,reps integer,lapses integer,left integer,odue integer,odid integer,flags integer,data text);
create table revlog(id integer primary key,cid integer,usn integer,ease integer,ivl integer,lastIvl integer,factor integer,time integer,type integer);
create table graves(usn integer,oid integer,type integer);`;

const SCHEMA18 = SCHEMA11 + `
create table deck_config(id integer primary key,name text,mtime_secs integer,usn integer,config blob);
create table config(KEY text primary key,usn integer,mtime_secs integer,val blob);
create table fields(ntid integer,ord integer,name text,config blob,primary key(ntid,ord));
create table templates(ntid integer,ord integer,name text,mtime_secs integer,usn integer,config blob,primary key(ntid,ord));
create table notetypes(id integer primary key,name text,mtime_secs integer,usn integer,config blob);
create table decks(id integer primary key,name text,mtime_secs integer,usn integer,common blob,kind blob);`;

async function db(schema: string) {
  const SQL = await initSqlJs();
  const d = new SQL.Database();
  d.run(schema);
  for (const n of notes) d.run('insert into notes values(?,?,?,?,?,?,?,?,?,?,?)', [n.id, n.guid, n.mid, 1_700_000_500, -1, n.tags, n.flds, '', 0, 0, '']);
  for (const c of cards) d.run('insert into cards values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [c.id, c.nid, c.did, c.ord, 0, -1, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.left, 0, 0, 0, c.data]);
  for (const r of revlog) d.run('insert into revlog values(?,?,?,?,?,?,?,?,?)', [r.id, r.cid, -1, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type]);
  return d;
}

const pack = (col: Uint8Array, name: string, mediaMap: Uint8Array) =>
  zipSync({ [name]: col, media: mediaMap, ...Object.fromEntries(Object.values(media).map((b, i) => [String(i), b])) });

export async function apkg11(): Promise<Uint8Array> {
  const d = await db(SCHEMA11);
  d.run('insert into col values(1,?,0,0,11,0,0,0,?,?,?,?,"{}")', [
    CRT, JSON.stringify({ rollover: 4 }),
    JSON.stringify({ 1: basicModel, 2: clozeModel }),
    JSON.stringify({ 1: { id: 1, name: 'Default', conf: 1 }, 3: { id: 3, name: 'Default::Sub', conf: 1 } }),
    JSON.stringify({ 1: dconf }),
  ]);
  const mediaMap = te.encode(JSON.stringify(Object.fromEntries(Object.keys(media).map((n, i) => [String(i), n]))));
  return pack(d.export(), 'collection.anki21', mediaMap);
}

export async function apkg18(): Promise<Uint8Array> {
  const d = await db(SCHEMA18);
  d.run('insert into col values(1,?,0,0,18,0,0,0,"{}","{}","{}","{}","{}")', [CRT]);
  d.run('insert into config values("rollover",0,0,?)', [te.encode('4')]);
  d.run('insert into config values("fsrs",0,0,?)', [te.encode('true')]);
  for (const m of [basicModel, clozeModel]) {
    d.run('insert into notetypes values(?,?,0,0,?)', [m.id, m.name, enc([{ n: 1, v: m.type }, { n: 3, v: m.css }])]);
    for (const f of m.flds) d.run('insert into fields values(?,?,?,?)', [m.id, f.ord, f.name, enc([])]);
    for (const t of m.tmpls) d.run('insert into templates values(?,?,?,0,0,?)', [m.id, t.ord, t.name, enc([{ n: 1, v: t.qfmt }, { n: 2, v: t.afmt }])]);
  }
  const kind = enc([{ n: 1, v: enc([{ n: 1, v: 1 }]) }]);
  d.run('insert into decks values(1,"Default",0,0,?,?)', [enc([]), kind]);
  d.run('insert into decks values(3,?,0,0,?,?)', ['Default\x1fSub', enc([]), kind]);
  d.run('insert into deck_config values(1,"Default",0,0,?)', [enc([
    { n: 1, v: [1, 10], kind: 'floats' }, { n: 2, v: [10], kind: 'floats' }, { n: 9, v: 20 }, { n: 10, v: 200 },
    { n: 11, v: 2.5, kind: 'float' }, { n: 16, v: 36500 }, { n: 18, v: 1 }, { n: 19, v: 4 }, { n: 37, v: 0.9, kind: 'float' },
    { n: 6, v: Array.from({ length: 21 }, (_, i) => 0.1 * (i + 1)), kind: 'floats' },
  ])]);
  const mediaMap = enc(Object.keys(media).map((n, i) => ({ n: 1, v: enc([{ n: 1, v: n }, { n: 255, v: i }]) })));
  return pack(d.export(), 'collection.anki21b', mediaMap);
}
