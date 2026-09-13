// Card display pipeline: render_card -> type-answer filters (qt/aqt/reviewer.py) -> av tags -> media URLs.
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import type { Next } from '../store/queries';
import { mediaUrl } from '../store/queries';
import { avRefsToPlayIcons, extractAvTags, type AvTag } from './avtags';
import { extractClozeForTyping } from './cloze';
import { renderCard } from './template';
import { REVIEWER_CSS, REVIEWER_JS } from './reviewer';
import { compareAnswer } from './typeanswer';

export interface Sides { q: string; a: string; css: string; qTags: AvTag[]; aTags: AvTag[]; typeCorrect?: string; typeFont: string; typeSize: number; combining: boolean }

const TYPE_ANS = /\[\[type:(.+?)\]\]/;

// Resolve src="file" on img/audio/source/object to blob URLs from IndexedDB.
async function resolveMedia(html: string): Promise<string> {
  const names = [...html.matchAll(/\s(?:src|data)=["']([^"']+)["']/g)].map((m) => m[1]!).filter((s) => !/^(https?:|data:|blob:)/.test(s));
  const urls = new Map(await Promise.all([...new Set(names)].map(async (n) => [n, await mediaUrl(decodeURIComponent(n))] as const)));
  return html.replace(/(\s(?:src|data)=["'])([^"']+)(["'])/g, (all, pre, src, post) => (urls.get(src) ? `${pre}${urls.get(src)}${post}` : all));
}

export async function buildSides(n: Next): Promise<Sides> {
  const tpl = n.notetype.templates[n.notetype.type === 1 ? 0 : n.card.ord] ?? n.notetype.templates[0]!;
  const fields = Object.fromEntries(n.notetype.fields.map((f, i) => [f.name, n.note.fields[i] ?? '']));
  const special = { Tags: n.note.tags.join(' '), Type: n.notetype.name, Deck: n.deck.name, Subdeck: n.deck.name.split('::').pop() ?? '', CardFlag: n.card.flags & 7 ? `flag${n.card.flags & 7}` : '', Card: tpl.name };
  const r = renderCard({ qfmt: tpl.qfmt, afmt: tpl.afmt, fields: { ...special, ...fields }, cardOrd: n.card.ord, isCloze: n.notetype.type === 1 });
  // typeAnsQuestionFilter
  let typeCorrect: string | undefined, typeFont = 'arial', typeSize = 20, combining = true;
  const m = TYPE_ANS.exec(r.q);
  let q = r.q, a = r.a;
  if (m) {
    let fld = m[1]!, clozeIdx: number | undefined;
    if (fld.startsWith('cloze:')) { clozeIdx = n.card.ord + 1; fld = fld.split(':')[1]!; }
    if (fld.startsWith('nc:')) { combining = false; fld = fld.split(':')[1]!; }
    const f = n.notetype.fields.find((x) => x.name === fld);
    if (f) { typeCorrect = fields[f.name]; if (clozeIdx) typeCorrect = extractClozeForTyping(typeCorrect ?? '', clozeIdx) || undefined; typeFont = f.font ?? typeFont; typeSize = f.size ?? typeSize; }
    if (!typeCorrect) q = q.replace(TYPE_ANS, f ? '' : clozeIdx ? 'Please run Tools>Empty Cards' : `Type answer: unknown field ${fld}`);
    else q = q.replace(TYPE_ANS, `\n<center>\n<input type=text id=typeans onkeypress="_typeAnsPress();"\n   style="font-family: '${typeFont}'; font-size: ${typeSize}px;">\n</center>\n`);
  }
  const [qAv, qTags] = extractAvTags(q, true);
  const [aAv, aTags] = extractAvTags(a, false);
  return { q: await resolveMedia(avRefsToPlayIcons(qAv)), a: await resolveMedia(avRefsToPlayIcons(aAv)), css: n.notetype.css, qTags, aTags, typeCorrect, typeFont, typeSize, combining };
}

// typeAnsAnswerFilter
export function answerHtml(s: Sides, typed: string): string {
  let buf = s.a;
  if (!s.typeCorrect) return buf.replace(TYPE_ANS, '');
  const m = TYPE_ANS.exec(buf);
  const orig = buf;
  const size = buf.length;
  buf = buf.replace('<hr id=answer>', '');
  const hadHR = buf.length !== size;
  const output = compareAnswer(s.typeCorrect, typed, s.combining);
  let repl = `\n<div style="font-family: '${s.typeFont}'; font-size: ${s.typeSize}px">${output}</div>`;
  if (hadHR) repl = `<hr id=answer>${repl}`;
  if (hadHR && !m) return orig;
  return buf.replace(TYPE_ANS, () => repl);
}

export function srcdoc(css: string, dark: boolean): string {
  return `<!doctype html><html class="${dark ? 'night-mode' : ''}"><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<style>${REVIEWER_CSS}</style><style>${css}</style></head>
<body class="card${dark ? ' nightMode night_mode' : ''}"><div id="qa"></div><script>${REVIEWER_JS}</script></body></html>`;
}
export const bodyClass = (n: Next, dark: boolean) => `card card${n.card.ord + 1}${dark ? ' nightMode night_mode' : ''}`;
