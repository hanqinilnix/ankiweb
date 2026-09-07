import { describe, expect, it } from 'vitest';
import { openPackage } from '../src/import/apkg';
import { openDb } from '../src/import/sqlite';
import { readCollection } from '../src/import/collection';
import { apkg11, apkg18, CRT } from './helpers/fixtures';

async function parse(bytes: Uint8Array) {
  const pkg = openPackage(bytes);
  const db = await openDb(pkg.collection);
  const parsed = readCollection(db, pkg.schema);
  db.close();
  return { pkg, parsed };
}

describe.each([['schema11', apkg11, 11], ['schema18', apkg18, 18]] as const)('%s', (_, mk, schema) => {
  it('parses collection', async () => {
    const { pkg, parsed: p } = await parse(await mk());
    expect(pkg.schema).toBe(schema);
    expect(p.col.crt).toBe(CRT);
    expect(p.col.rollover).toBe(4);
    expect(p.notetypes.map((n) => [n.name, n.type, n.fields.length, n.templates[0]!.qfmt])).toEqual([
      ['Basic', 0, 2, '{{Front}}'], ['Cloze', 1, 2, '{{cloze:Text}}'],
    ]);
    expect(p.notetypes[0]!.css).toContain('font-size');
    expect(p.decks.map((d) => [d.name, d.confId, d.parentId])).toEqual([['Default', 1, undefined], ['Default::Sub', 1, 1]]);
    const c = p.dconf[0]!;
    expect([c.newPerDay, c.revPerDay, c.learnSteps, c.relearnSteps, c.graduatingIvl, c.easyIvl, c.maxIvl]).toEqual([20, 200, [1, 10], [10], 1, 4, 36500]);
    expect(c.startEase).toBeCloseTo(2.5);
    expect(c.desiredRetention).toBeCloseTo(0.9);
    expect(p.notes.map((n) => [n.guid, n.fields.length, n.tags])).toEqual([['g-basic-1', 2, ['t1', 't2']], ['g-cloze-1', 2, []]]);
    expect(p.cards).toHaveLength(3);
    expect(p.cards[1]!.fsrs).toEqual({ s: 4.2, d: 5.1 });
    expect(p.cards[0]!.fsrs).toBeUndefined();
    expect(p.revlog).toHaveLength(1);
    expect([...pkg.media.values()].sort()).toEqual(['hi.mp3', 'pic.png']);
    expect(new TextDecoder().decode(pkg.zip[[...pkg.media].find(([, n]) => n === 'pic.png')![0]])).toBe('PNG');
  });
});

it('schema18 reads fsrs flag and params', async () => {
  const { parsed } = await parse(await apkg18());
  expect(parsed.col.fsrs).toBe(true);
  expect(parsed.dconf[0]!.fsrsParams).toHaveLength(21);
});
