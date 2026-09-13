// Port of the parts of rslib/src/text.rs used by rendering.
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
const HTML = /(<!--[\s\S]*?-->)|(<style[\s\S]*?>[\s\S]*?<\/style>)|(<script[\s\S]*?>[\s\S]*?<\/script>)|(<[\s\S]*?>)/gi;
const HTML_LINEBREAK_TAGS = /<\/?(?:br|address|article|aside|blockquote|canvas|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|noscript|ol|output|p|pre|section|table|tfoot|ul|video)>/gi;
const PERSISTENT_HTML_SPACERS = /<br\s*\/?>|<div>|\n/gi;
const TYPE_TAG = /\[\[type:[^\]]+\]\]/g;
export const SOUND_TAG = /\[sound:([^\]]+)\]/g;

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', darr: '↓' };
export function decodeEntities(html: string): string {
  if (!html.includes('&')) return html;
  return html.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const cp = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(cp) ? String.fromCodePoint(cp) : m; }
    return NAMED[e] ?? m;
  }).replace(/ /g, ' ');
}
export const encodeMinimal = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const encodeAttribute = (s: string) => encodeMinimal(s).replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

export const stripHtmlPreservingEntities = (html: string) => html.replace(HTML, '');
export const stripHtml = (html: string) => decodeEntities(stripHtmlPreservingEntities(html));
export const stripHtmlForTts = (html: string) => stripHtml(html.replace(HTML_LINEBREAK_TAGS, ' '));
export const isHtml = (s: string) => { HTML.lastIndex = 0; return HTML.test(s); };

export function htmlToTextLine(html: string, preserveMediaFilenames: boolean): string {
  let s = html.replace(PERSISTENT_HTML_SPACERS, ' ').replace(TYPE_TAG, '').replace(SOUND_TAG, preserveMediaFilenames ? '$1' : '');
  s = preserveMediaFilenames ? stripHtmlPreservingMediaFilenames(s) : stripHtml(s);
  return s.trim();
}
const HTML_MEDIA_TAGS = /<\b(?:img|audio|video|object|source)\b(?:[^>]|"[^"]+?"|'[^']+?')+?\b(?:src|data)\b=(?:"([^"]+?)"[^>]*>|'([^']+?)'[^>]*>|([^ >]+?)(?:\x20[^>]*>|>))/gi;
export const stripHtmlPreservingMediaFilenames = (html: string) => stripHtml(html.replace(HTML_MEDIA_TAGS, (_, a, b, c) => ` ${a ?? b ?? c} `));

// template.rs field_is_empty
export const fieldIsEmpty = (text: string) => /^(?:\s|<\/?(?:br|div) ?\/?>)*$/i.test(text);
