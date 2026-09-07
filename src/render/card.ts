import type { Next } from '../store/queries';
import { mediaUrl } from '../store/queries';
import { hasMath, render, soundToAudio, type RenderCtx } from './template';

export interface Sides { q: string; a: string; css: string; math: boolean }

// Resolve src="file" on img/audio/source to blob URLs from IndexedDB.
async function resolveMedia(html: string): Promise<string> {
  const names = [...html.matchAll(/\ssrc=["']([^"']+)["']/g)].map((m) => m[1]!).filter((s) => !/^(https?:|data:|blob:)/.test(s));
  const urls = new Map(await Promise.all([...new Set(names)].map(async (n) => [n, await mediaUrl(decodeURIComponent(n))] as const)));
  return html.replace(/(\ssrc=["'])([^"']+)(["'])/g, (all, pre, src, post) => (urls.get(src) ? `${pre}${urls.get(src)}${post}` : all));
}

export async function buildSides(n: Next): Promise<Sides> {
  const tpl = n.notetype.templates[n.notetype.type === 1 ? 0 : n.card.ord] ?? n.notetype.templates[0]!;
  const ctx: RenderCtx = {
    fields: Object.fromEntries(n.notetype.fields.map((f, i) => [f.name, n.note.fields[i] ?? ''])),
    tags: n.note.tags, deck: n.deck.name, card: tpl.name,
    ...(n.notetype.type === 1 && { clozeOrd: n.card.ord + 1 }),
  };
  const q = render(tpl.qfmt, ctx, false);
  const a = render(tpl.afmt, ctx, true, q);
  return { q: await resolveMedia(soundToAudio(q)), a: await resolveMedia(soundToAudio(a)), css: n.notetype.css, math: hasMath(q + a) };
}

const MATHJAX = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';

export function srcdoc(html: string, css: string, math: boolean, dark: boolean): string {
  const body = html.replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, '\\($1\\)').replace(/\[\$\$\]([\s\S]*?)\[\/\$\$\]/g, '\\[$1\\]');
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<style>html{color-scheme:${dark ? 'dark' : 'light'}}body{margin:0;padding:16px;font-family:-apple-system,system-ui,sans-serif;text-align:center}
img{max-width:100%}${css}</style>
<script>addEventListener('keydown',e=>parent.postMessage({key:e.key},'*'))</script>
${math ? `<script>MathJax={tex:{inlineMath:[['\\\\(','\\\\)']]}}</script><script src="${MATHJAX}"></script>` : ''}
<div class="card${dark ? ' nightMode night_mode' : ''}">${body}</div>`;
}
