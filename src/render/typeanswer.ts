// Port of rslib/src/typeanswer.rs, with a SequenceMatcher port (Python difflib semantics, autojunk on).
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import { stripAvTags } from './avtags';
import { encodeMinimal, stripHtml } from './text';

const LINEBREAKS = /(\n|<br\s?\/?>|<\/?div>)+/gi;
const fmt = (s: string) => `<code id=typeans>${s}</code>`;
const isMark = (c: string) => /\p{M}/u.test(c);

export function compareAnswer(expected: string, typed: string, combining: boolean): string {
  const stripped = stripExpected(expected);
  if (!typed) return fmt(encodeMinimal(stripped));
  return (combining ? new Diff(stripped, typed) : new DiffNonCombining(stripped, typed)).toHtml();
}
export const stripExpected = (expected: string) => stripHtml(stripAvTags(expected).replace(LINEBREAKS, ' ')).trim();

// ---- difflib.SequenceMatcher (get_opcodes) ----
type Op = [tag: 'equal' | 'replace' | 'delete' | 'insert', i1: number, i2: number, j1: number, j2: number];
export function opcodes(a: string[], b: string[]): Op[] {
  const b2j = new Map<string, number[]>();
  b.forEach((x, i) => (b2j.get(x) ?? b2j.set(x, []).get(x)!).push(i));
  const n = b.length;
  if (n >= 200) { const popular = new Set<string>(); const t = Math.floor(n / 100) + 1; for (const [k, v] of b2j) if (v.length > t) popular.add(k); for (const k of popular) b2j.delete(k); }
  const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      for (const j of b2j.get(a[i]!) ?? []) {
        if (j < blo) continue; if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  };
  const blocks: [number, number, number][] = [];
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) { blocks.push([i, j, k]); if (alo < i && blo < j) queue.push([alo, i, blo, j]); if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]); }
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged: [number, number, number][] = [];
  for (const [i, j, k] of blocks) { const last = merged[merged.length - 1]; if (last && last[0] + last[2] === i && last[1] + last[2] === j) last[2] += k; else merged.push([i, j, k]); }
  merged.push([a.length, b.length, 0]);
  const ops: Op[] = [];
  let i = 0, j = 0;
  for (const [ai, bj, size] of merged) {
    const tag = i < ai && j < bj ? 'replace' : i < ai ? 'delete' : j < bj ? 'insert' : '';
    if (tag) ops.push([tag, i, ai, j, bj]);
    i = ai + size; j = bj + size;
    if (size) ops.push(['equal', ai, i, bj, j]);
  }
  return ops;
}

type Kind = 'typeGood' | 'typeBad' | 'typeMissed';
interface Tok { kind: Kind; text: string }
const chars = (s: string) => [...s];

class Diff {
  typed: string[]; expected: string[];
  constructor(expected: string, typed: string) { this.typed = chars(typed.normalize('NFC')); this.expected = chars(expected.normalize('NFC')); }
  expectedOriginal() { return this.expected.join(''); }
  toTokens(): { typed: Tok[]; expected: Tok[] } {
    const typed: Tok[] = [], expected: Tok[] = [];
    for (const [tag, i1, i2, j1, j2] of opcodes(this.typed, this.expected)) {
      const t = this.typed.slice(i1, i2).join(''), e = this.expected.slice(j1, j2).join('');
      if (tag === 'equal') { typed.push({ kind: 'typeGood', text: t }); expected.push({ kind: 'typeGood', text: e }); }
      else if (tag === 'delete') typed.push({ kind: 'typeBad', text: t });
      else if (tag === 'insert') { typed.push({ kind: 'typeMissed', text: '-'.repeat(chars(e).length) }); expected.push({ kind: 'typeMissed', text: e }); }
      else { typed.push({ kind: 'typeBad', text: t }); expected.push({ kind: 'typeMissed', text: e }); }
    }
    return { typed, expected };
  }
  renderExpected(tokens: Tok[]) { return renderTokens(tokens); }
  toHtml(): string {
    if (this.typed.join('') === this.expected.join('')) return fmt(`<span class=typeGood>${encodeMinimal(this.expectedOriginal())}</span>`);
    const o = this.toTokens();
    return fmt(`${renderTokens(o.typed)}<br><span id=typearrow>&darr;</span><br>${this.renderExpected(o.expected)}`);
  }
}
const isolateLeadingMark = (t: string) => (t && isMark(chars(t)[0]!) ? ` ${t}` : t);
const renderTokens = (tokens: Tok[]) => tokens.map((t) => `<span class=${t.kind}>${encodeMinimal(isolateLeadingMark(t.text))}</span>`).join('');

class DiffNonCombining extends Diff {
  private split: string[] = []; private original: string;
  constructor(expected: string, typed: string) {
    super('', '');
    this.typed = chars(typed.normalize('NFKD')).filter((c) => !isMark(c));
    this.expected = [];
    for (const c of chars(expected.normalize('NFKD'))) {
      if (isMark(c)) { if (this.split.length) this.split[this.split.length - 1] += c; }
      else { this.expected.push(c); this.split.push(c); }
    }
    this.original = expected;
  }
  override expectedOriginal() { return this.original; }
  override renderExpected(tokens: Tok[]) {
    let idx = 0;
    return tokens.map((t) => { const end = idx + chars(t.text).length; const txt = this.split.slice(idx, end).join(''); idx = end; return `<span class=${t.kind}>${encodeMinimal(txt)}</span>`; }).join('');
  }
}
export { Diff, DiffNonCombining };
