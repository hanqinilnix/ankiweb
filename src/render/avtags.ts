// Port of rslib/src/card_rendering/{parser,writer}.rs: [sound:] and [anki:tts] handling.
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import { decodeEntities, stripHtmlForTts } from './text';

export type AvTag = { sound: string } | { tts: { text: string; lang: string; voices: string[]; speed: number; other: string[] } };
type Node = { text: string } | { sound: string } | { directive: { name: string; options: [string, string][]; content: string } };

function parse(txt: string): Node[] {
  const nodes: Node[] = [];
  let i = 0;
  const textTill = (from: number) => { const p = txt.indexOf('[', from + 1); return p < 0 ? txt.length : p; };
  while (i < txt.length) {
    if (txt.startsWith('[sound:', i)) {
      const e = txt.indexOf(']', i + 7);
      if (e > i + 7) { nodes.push({ sound: txt.slice(i + 7, e) }); i = e + 1; continue; }
    }
    if (txt.startsWith('[anki:', i)) {
      const d = parseDirective(txt, i);
      if (d) { nodes.push({ directive: d.node }); i = d.end; continue; }
    }
    const e = textTill(i);
    nodes.push({ text: txt.slice(i, e) }); i = e;
  }
  return nodes;
}
function parseDirective(txt: string, i: number): { node: { name: string; options: [string, string][]; content: string }; end: number } | undefined {
  const m = /^\[anki:([^\] \t\r\n]+)/.exec(txt.slice(i));
  if (!m) return;
  const name = m[1]!;
  let p = i + m[0].length;
  const options: [string, string][] = [];
  for (;;) {
    while (/[ \t\r\n]/.test(txt[p] ?? '')) p++;
    if (txt[p] === ']') { p++; break; }
    const k = /^[^\] \t\r\n=]+=/.exec(txt.slice(p));
    if (!k) return;
    p += k[0].length;
    let v: string;
    if (txt[p] === '"') { const e = txt.indexOf('"', p + 1); if (e < 0) return; v = txt.slice(p + 1, e); p = e + 1; }
    else { const vm = /^[^\] \t\r\n"]*/.exec(txt.slice(p))!; v = vm[0]; p += v.length; }
    options.push([k[0].slice(0, -1), v]);
  }
  const closing = `[/anki:${name}]`;
  const e = txt.indexOf(closing, p);
  if (e < 0) return;
  return { node: { name, options, content: txt.slice(p, e) }, end: e + closing.length };
}

export function stripAvTags(txt: string): string {
  if (!txt.includes('[')) return txt;
  return parse(txt).map((n) => ('text' in n ? n.text : 'directive' in n && n.directive.name !== 'tts' ? writeDirective(n.directive) : '')).join('');
}
const writeDirective = (d: { name: string; options: [string, string][]; content: string }) =>
  `[anki:${d.name}${d.options.map(([k, v]) => (/[\] \t\r\n]/.test(v) ? ` ${k}="${v}"` : ` ${k}=${v}`)).join('')}]${d.content}[/anki:${d.name}]`;

export function extractAvTags(txt: string, questionSide: boolean): [string, AvTag[]] {
  if (!txt.includes('[')) return [txt, []];
  const tags: AvTag[] = [];
  const side = questionSide ? 'q' : 'a';
  const out = parse(txt).map((n) => {
    if ('text' in n) return n.text;
    if ('sound' in n) { tags.push({ sound: decodeEntities(n.sound) }); return `[anki:play:${side}:${tags.length - 1}]`; }
    const d = n.directive;
    if (d.name !== 'tts') return writeDirective(d);
    const o = Object.fromEntries(d.options);
    if (!o.lang) return `[Bad directive anki:tts: option lang not set]`;
    const blank = o.cloze_blank ?? 'blank';
    tags.push({ tts: { text: stripHtmlForTts(d.content).replace('[...]', blank), lang: o.lang, voices: o.voices ? o.voices.split(',') : [], speed: Number(o.speed ?? 1) || 1, other: d.options.filter(([k]) => !['lang', 'voices', 'speed', 'cloze_blank'].includes(k)).map(([k, v]) => `${k}=${v}`) } });
    return `[anki:play:${side}:${tags.length - 1}]`;
  });
  return [out.join(''), tags];
}

// qt/aqt/sound.py av_refs_to_play_icons
const PLAY_SVG = '<svg class="playImage" viewBox="0 0 64 64" version="1.1"><circle cx="32" cy="32" r="29" /><path d="M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z" /></svg>';
export const avRefsToPlayIcons = (text: string) =>
  text.replace(/\[anki:(play:[qa]:\d+)\]/g, (_, ref) => `<a class="replay-button soundLink" href=# onclick="pycmd('${ref}'); return false;" draggable="false">${PLAY_SVG}</a>`);
