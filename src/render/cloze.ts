// Port of rslib/src/cloze.rs (image occlusion shapes omitted).
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import { encodeAttribute, stripHtmlPreservingEntities } from './text';

type Token = { t: 'open'; ords: number[] } | { t: 'text'; s: string } | { t: 'close' };

function* tokenize(text: string): Generator<Token> {
  let i = 0;
  const tryOpen = (pos: number): [number, number[]] | undefined => {
    if (!text.startsWith('{{c', pos)) return;
    let j = pos + 3;
    while (j < text.length && /[0-9,]/.test(text[j]!)) j++;
    const ords = [...new Set(text.slice(pos + 3, j).split(',').filter((s) => /^\d+$/.test(s)).map(Number))].sort((a, b) => a - b);
    if (!ords.length || !text.startsWith('::', j)) return;
    return [j + 2, ords];
  };
  while (i < text.length) {
    const o = tryOpen(i);
    if (o) { yield { t: 'open', ords: o[1] }; i = o[0]; continue; }
    if (text.startsWith('}}', i)) { yield { t: 'close' }; i += 2; continue; }
    let j = i + 1;
    while (j < text.length && !tryOpen(j) && !text.startsWith('}}', j)) j++;
    yield { t: 'text', s: text.slice(i, j) }; i = j;
  }
}

interface Cloze { ords: number[]; nodes: Node[]; hint?: string }
type Node = { text: string } | { cloze: Cloze };
const hintOf = (c: Cloze) => c.hint ?? '...';
const clozedText = (c: Cloze): string => c.nodes.map((n) => ('text' in n ? n.text : clozedText(n.cloze))).join('');
const ordsStr = (o: number[]) => o.join(',');

export function parseTextWithClozes(text: string): Node[] {
  const open: Cloze[] = [];
  const out: Node[] = [];
  for (const tok of tokenize(text)) {
    if (tok.t === 'open') { if (open.length < 10) open.push({ ords: tok.ords, nodes: [] }); }
    else if (tok.t === 'text') {
      const cur = open[open.length - 1];
      let s = tok.s;
      if (cur) {
        if (!s.startsWith('image-occlusion:')) { const i = s.indexOf('::'); if (i >= 0) { cur.hint = s.slice(i + 2); s = s.slice(0, i); } }
        cur.nodes.push({ text: s });
      } else out.push({ text: s });
    } else {
      const c = open.pop();
      if (c) (open[open.length - 1]?.nodes ?? out).push({ cloze: c });
      else out.push({ text: '}}' });
    }
  }
  return out;
}

function revealCloze(c: Cloze, ord: number, question: boolean, found: { v: boolean }, buf: string[]) {
  const active = c.ords.includes(ord);
  found.v ||= active;
  const first = c.nodes[0];
  if (first && 'text' in first && first.text.startsWith('image-occlusion:')) {
    // shapes not rendered; keep a marker so the card is not blank
    buf.push(`<div class="${(question && active) || c.ords.includes(0) ? 'cloze' : active ? 'cloze-highlight' : 'cloze-inactive'}" data-ordinal="${ordsStr(c.ords)}"></div>`);
    return;
  }
  const inner = (target: string[]) => { for (const n of c.nodes) { if ('text' in n) target.push(n.text); else revealCloze(n.cloze, ord, question, found, target); } };
  if (question && active) {
    const content: string[] = [];
    inner(content);
    buf.push(`<span class="cloze" data-cloze="${encodeAttribute(content.join(''))}" data-ordinal="${ordsStr(c.ords)}">[${hintOf(c)}]</span>`);
  } else if (active) {
    buf.push(`<span class="cloze" data-ordinal="${ordsStr(c.ords)}">`); inner(buf); buf.push('</span>');
  } else {
    buf.push(`<span class="cloze-inactive" data-ordinal="${ordsStr(c.ords)}">`); inner(buf); buf.push('</span>');
  }
}

export function revealClozeText(text: string, ord: number, question: boolean): string {
  const buf: string[] = [], found = { v: false };
  for (const n of parseTextWithClozes(text)) { if ('text' in n) buf.push(n.text); else revealCloze(n.cloze, ord, question, found, buf); }
  return found.v ? buf.join('') : '';
}

function revealInNodes(n: Node, ord: number, question: boolean, out: string[]) {
  if (!('cloze' in n)) return;
  if (n.cloze.ords.includes(ord)) out.push(question ? hintOf(n.cloze) : clozedText(n.cloze));
  for (const child of n.cloze.nodes) revealInNodes(child, ord, question, out);
}
export function revealClozeTextOnly(text: string, ord: number, question: boolean): string {
  const out: string[] = [];
  for (const n of parseTextWithClozes(text)) revealInNodes(n, ord, question, out);
  return out.join(', ');
}
export function extractClozeForTyping(text: string, ord: number): string {
  const out: string[] = [];
  for (const n of parseTextWithClozes(text)) revealInNodes(n, ord, false, out);
  if (!out.length) return '';
  return out.every((s) => s === out[0]) ? out[0]! : out.join(', ');
}

function addNums(nodes: Node[], set: Set<number>) {
  for (const n of nodes) if ('cloze' in n) { for (const o of n.cloze.ords) if (o !== 0) set.add(o); addNums(n.cloze.nodes, set); }
}
export const clozeNumbersInString = (s: string) => { const set = new Set<number>(); addNums(parseTextWithClozes(s), set); return set; };
export const clozeNumberInFields = (fields: Iterable<string>) => { const set = new Set<number>(); for (const f of fields) addNums(parseTextWithClozes(f), set); return set; };
export const containsCloze = (s: string) => parseTextWithClozes(s).some((n) => 'cloze' in n && n.cloze.ords.some((o) => o !== 0));
export const stripClozes = (s: string) => s.replace(/\{\{c[\d,]+::([\s\S]*?)(::[\s\S]*?)?\}\}/g, '$1');

const MATHJAX = /(\\[([])([\s\S]*?)(\\[\])])/gi;
export const stripHtmlInsideMathjax = (s: string) => s.replace(MATHJAX, (_, o, inner, c) => `${o}${stripHtmlPreservingEntities(inner)}${c}`);

export const clozeFilter = (text: string, ord: number, question: boolean) => stripHtmlInsideMathjax(revealClozeText(text, ord, question));
export const clozeOnlyFilter = (text: string, ord: number, question: boolean) => revealClozeTextOnly(text, ord, question);
