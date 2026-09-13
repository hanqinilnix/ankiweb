// Port of rslib/src/template.rs and template_filters.rs (rendering paths only).
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import { clozeFilter, clozeNumberInFields, clozeOnlyFilter } from './cloze';
import { encodeMinimal, fieldIsEmpty, stripHtml } from './text';

export const COMMENT_START = '<!--', COMMENT_END = '-->';
const ALT_DIRECTIVE = '{{=<% %>=}}';
const ERROR_LINK = 'https://docs.ankiweb.net/templates/errors.html#template-syntax-error';
const BLANK_LINK = 'https://docs.ankiweb.net/templates/errors.html#front-of-card-is-blank';
const BLANK_CLOZE_LINK = 'https://docs.ankiweb.net/templates/errors.html#no-cloze-filter-on-cloze-note-type';

type Token = { t: 'text' | 'comment' | 'repl' | 'open' | 'neg' | 'close'; s: string };
export type ParsedNode =
  | { kind: 'text'; text: string } | { kind: 'comment'; text: string }
  | { kind: 'repl'; key: string; filters: string[] }
  | { kind: 'cond'; key: string; children: ParsedNode[] } | { kind: 'neg'; key: string; children: ParsedNode[] };

export class TemplateError extends Error {
  constructor(readonly code: 'notClosed' | 'notOpen' | 'fieldNotFound' | 'noSuchConditional', readonly detail: string) { super(`${code}: ${detail}`); }
}

function classify(s: string): Token {
  const start = s.replace(/^\{+/, '').trim();
  if (start.length < 2) return { t: 'repl', s: start };
  if (start.startsWith('#')) return { t: 'open', s: start.slice(1).trimStart() };
  if (start.startsWith('/')) return { t: 'close', s: start.slice(1).trimStart() };
  if (start.startsWith('^')) return { t: 'neg', s: start.slice(1).trimStart() };
  return { t: 'repl', s: start };
}

function* tokens(template: string): Generator<Token> {
  let [open, close] = ['{{', '}}'];
  if (template.trimStart().startsWith(ALT_DIRECTIVE)) { template = template.trimStart().slice(ALT_DIRECTIVE.length); [open, close] = ['<%', '%>']; }
  let i = 0;
  while (i < template.length) {
    let found = -1, kind: 'h' | 'c' = 'h', end = -1;
    for (let j = i; j < template.length; j++) {
      if (template.startsWith(open, j)) { const e = template.indexOf(close, j + open.length); if (e >= 0) { found = j; kind = 'h'; end = e + close.length; break; } }
      if (template.startsWith(COMMENT_START, j)) { const e = template.indexOf(COMMENT_END, j + COMMENT_START.length); if (e >= 0) { found = j; kind = 'c'; end = e + COMMENT_END.length; break; } }
    }
    if (found < 0) { yield { t: 'text', s: template.slice(i) }; return; }
    if (found > i) yield { t: 'text', s: template.slice(i, found) };
    if (kind === 'h') yield classify(template.slice(found + open.length, end - close.length));
    else yield { t: 'comment', s: template.slice(found + COMMENT_START.length, end - COMMENT_END.length) };
    i = end;
  }
}

function parseInner(it: Iterator<Token>, openTag?: string): ParsedNode[] {
  const nodes: ParsedNode[] = [];
  for (;;) {
    const r = it.next();
    if (r.done) break;
    const tok = r.value;
    switch (tok.t) {
      case 'text': nodes.push({ kind: 'text', text: tok.s }); break;
      case 'comment': nodes.push({ kind: 'comment', text: tok.s }); break;
      case 'repl': { const parts = tok.s.split(':'); const key = parts.pop()!; nodes.push({ kind: 'repl', key, filters: parts.reverse() }); break; }
      case 'open': nodes.push({ kind: 'cond', key: tok.s, children: parseInner(it, tok.s) }); break;
      case 'neg': nodes.push({ kind: 'neg', key: tok.s, children: parseInner(it, tok.s) }); break;
      case 'close':
        if (openTag === tok.s) return nodes;
        throw new TemplateError('notOpen', openTag ? `{{/${tok.s}}} closed while {{/${openTag}}} open` : `{{/${tok.s}}} without opening tag`);
    }
  }
  if (openTag !== undefined) throw new TemplateError('notClosed', `{{/${openTag}}}`);
  return nodes;
}

export class ParsedTemplate {
  constructor(readonly nodes: ParsedNode[]) {}
  static fromText(t: string) { return new ParsedTemplate(parseInner(tokens(t))); }
  rendersWithFields(nonempty: Set<string>) { return !templateIsEmpty(nonempty, this.nodes, true); }
  toString(): string { return nodesToString(this.nodes); }
}

function nodesToString(nodes: ParsedNode[]): string {
  return nodes.map((n) => {
    switch (n.kind) {
      case 'text': return n.text;
      case 'comment': return `${COMMENT_START}${n.text}${COMMENT_END}`;
      case 'repl': return `{{${[...n.filters].reverse().concat(n.key).join(':')}}}`;
      case 'cond': return `{{#${n.key}}}${nodesToString(n.children)}{{/${n.key}}}`;
      case 'neg': return `{{^${n.key}}}${nodesToString(n.children)}{{/${n.key}}}`;
    }
  }).join('');
}

function templateIsEmpty(nonempty: Set<string>, nodes: ParsedNode[], checkNegated: boolean): boolean {
  for (const n of nodes) {
    if (n.kind === 'repl') { if (nonempty.has(n.key)) return false; }
    else if (n.kind === 'cond') { if (nonempty.has(n.key) && !templateIsEmpty(nonempty, n.children, checkNegated)) return false; }
    else if (n.kind === 'neg') { if (checkNegated && nonempty.has(n.key)) continue; if (!templateIsEmpty(nonempty, n.children, checkNegated)) return false; }
  }
  return true;
}

export interface RenderContext { fields: Record<string, string>; nonempty: Set<string>; cardOrd: number; frontside?: string }
const isClozeConditional = (key: string) => /^c\d+$/.test(key);

function evalConditional(ctx: RenderContext, key: string, negated: boolean): boolean {
  if (ctx.nonempty.has(key)) return !negated;
  if (key in ctx.fields || isClozeConditional(key)) return negated;
  throw new TemplateError('noSuchConditional', `${negated ? '^' : '#'}${key}`);
}

function renderInto(out: string[], nodes: ParsedNode[], ctx: RenderContext) {
  for (const n of nodes) {
    switch (n.kind) {
      case 'text': out.push(n.text); break;
      case 'comment': out.push(COMMENT_START, n.text, COMMENT_END); break;
      case 'repl':
        if (n.key === 'FrontSide') { out.push(ctx.frontside ?? ''); break; }
        if (n.key === '' && n.filters.length) break;
        if (!(n.key in ctx.fields)) throw new TemplateError('fieldNotFound', `{{${[...n.filters].reverse().concat('').join(':')}${n.key}}}`);
        out.push(applyFilters(ctx.fields[n.key]!, n.filters, n.key, ctx));
        break;
      case 'cond': if (evalConditional(ctx, n.key, false)) renderInto(out, n.children, ctx); else renderInto([], n.children, ctx); break;
      case 'neg': if (evalConditional(ctx, n.key, true)) renderInto(out, n.children, ctx); else renderInto([], n.children, ctx); break;
    }
  }
}

// ---- template_filters.rs ----
export function applyFilters(text: string, filters: string[], field: string, ctx: RenderContext): string {
  const last = filters[filters.length - 1];
  if (last === 'type') {
    if (filters.length === 2 && filters[0] === 'cloze') return `[[type:cloze:${field}]]`;
    if (filters.length === 2 && filters[0] === 'nc') return `[[type:nc:${field}]]`;
    return `[[type:${field}]]`;
  }
  for (const f of filters) text = applyFilter(f, text, field, ctx) ?? text;
  return text;
}
function applyFilter(name: string, text: string, field: string, ctx: RenderContext): string | undefined {
  switch (name) {
    case 'text': return stripHtml(text);
    case 'furigana': return furigana(text);
    case 'kanji': return kanji(text);
    case 'kana': return kana(text);
    case 'type': return `[[type:${field}]]`;
    case 'type-cloze': return `[[type:cloze:${field}]]`;
    case 'type-nc': return `[[type:nc:${field}]]`;
    case 'hint': return hintFilter(text, field);
    case 'cloze': return clozeFilter(text, ctx.cardOrd + 1, ctx.frontside === undefined);
    case 'cloze-only': return clozeOnlyFilter(text, ctx.cardOrd + 1, ctx.frontside === undefined);
    case '': return text;
    default: return name.startsWith('tts ') ? `[anki:tts lang=${name.slice(4)}]${text}[/anki:tts]` : undefined; // unknown filters pass through
  }
}
const FURIGANA = / ?([^ >]+?)\[(.+?)\]/g;
const isSound = (r: string) => r.startsWith('sound:');
const kana = (t: string) => t.replace(/&nbsp;/g, ' ').replace(FURIGANA, (m, _k, r) => (isSound(r) ? m : r));
const kanji = (t: string) => t.replace(/&nbsp;/g, ' ').replace(FURIGANA, (m, k, r) => (isSound(r) ? m : k));
const furigana = (t: string) => t.replace(/&nbsp;/g, ' ').replace(FURIGANA, (m, k, r) => (isSound(r) ? m : `<ruby><rb>${k}</rb><rt>${r}</rt></ruby>`));
// Anki hashes with blake3; FNV-1a 64 is used here, ids only need to be unique per page.
function hintId(text: string, field: string): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of new TextEncoder().encode(text + field)) { h ^= BigInt(ch); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, '0');
}
function hintFilter(text: string, field: string): string {
  if (!text.trim()) return text;
  const id = hintId(text, field);
  return `\n<a class=hint href="#"\nonclick="this.style.display='none';\ndocument.getElementById('hint${id}').style.display='block';\nreturn false;" draggable=false>\n${field}</a>\n<div id="hint${id}" class=hint style="display: none">${text}</div>\n`;
}

// ---- render_card ----
export const nonemptyFields = (fields: Record<string, string>) => new Set(Object.keys(fields).filter((k) => !fieldIsEmpty(fields[k]!)));

export interface RenderCardRequest { qfmt: string; afmt: string; fields: Record<string, string>; cardOrd: number; isCloze: boolean; browser?: boolean }
export interface RenderCardResponse { q: string; a: string; isEmpty: boolean }

const MORE_INFO = 'More information';
function errorHtml(side: 'front' | 'back', e: unknown): string {
  const msg = e instanceof TemplateError ? e.message : String(e);
  return `<div>There is a problem with the ${side} of this card.<br>${encodeMinimal(msg)}<br><a href='${ERROR_LINK}'>${MORE_INFO}</a></div>`;
}

export function renderCard(req: RenderCardRequest): RenderCardResponse {
  const ctx: RenderContext = { fields: req.fields, nonempty: nonemptyFields(req.fields), cardOrd: req.cardOrd };
  let qtmpl: ParsedTemplate, q: string;
  try { qtmpl = ParsedTemplate.fromText(req.qfmt); const out: string[] = []; renderInto(out, qtmpl.nodes, ctx); q = out.join(''); }
  catch (e) { const t = errorHtml('front', e); return { q: t, a: t, isEmpty: true }; }
  let empty: string | undefined;
  if (req.isCloze && !clozeNumberInFields(Object.values(req.fields)).has(req.cardOrd + 1))
    empty = `<div>Cloze ${req.cardOrd + 1} does not exist. Please use the Empty Cards tool.<br><a href='${BLANK_CLOZE_LINK}'>${MORE_INFO}</a></div>`;
  else if (!req.isCloze && !req.browser && !qtmpl.rendersWithFields(ctx.nonempty))
    empty = `<div>The front of this card is blank.<br><a href='${BLANK_LINK}'>${MORE_INFO}</a></div>`;
  if (empty) return { q: q + empty, a: empty, isEmpty: true };
  ctx.frontside = q;
  try { const out: string[] = []; renderInto(out, ParsedTemplate.fromText(req.afmt).nodes, ctx); return { q, a: out.join(''), isEmpty: false }; }
  catch (e) { return { q, a: errorHtml('back', e), isEmpty: false }; }
}
