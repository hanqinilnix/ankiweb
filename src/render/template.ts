// Anki card template renderer. Fields are raw HTML (Anki stores HTML in fields).
export interface RenderCtx {
  fields: Record<string, string>;
  clozeOrd?: number; // 1-based, cloze notetypes only
  tags?: string[]; deck?: string; card?: string;
}

const clozeRe = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function cloze(text: string, ord: number, answer: boolean): string {
  return text.replace(clozeRe, (_, n, body, hint) => {
    if (Number(n) !== ord) return body;
    if (answer) return `<span class="cloze">${body}</span>`;
    return `<span class="cloze">[${hint ?? '...'}]</span>`;
  });
}

export const hasCloze = (text: string, ord: number) => [...text.matchAll(clozeRe)].some((m) => Number(m[1]) === ord);

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').trim();

function value(name: string, ctx: RenderCtx, answer: boolean): string | undefined {
  const [mod, field] = name.includes(':') ? [name.slice(0, name.indexOf(':')), name.slice(name.indexOf(':') + 1)] : [undefined, name];
  if (field === 'FrontSide') return undefined; // handled by caller
  if (field === 'Tags') return (ctx.tags ?? []).join(' ');
  if (field === 'Deck') return ctx.deck ?? '';
  if (field === 'Subdeck') return (ctx.deck ?? '').split('::').pop() ?? '';
  if (field === 'Card') return ctx.card ?? '';
  const raw = ctx.fields[field];
  if (raw === undefined) return undefined;
  switch (mod) {
    case undefined: return raw;
    case 'cloze': return cloze(raw, ctx.clozeOrd ?? 1, answer);
    case 'hint': return stripHtml(raw) ? `<details class="hint"><summary>${field}</summary>${raw}</details>` : '';
    case 'type': return `<input class="typeans" data-answer="${stripHtml(raw).replace(/"/g, '&quot;')}" placeholder="type answer">`;
    case 'text': return stripHtml(raw);
    default: return raw;
  }
}

function sections(tpl: string, ctx: RenderCtx): string {
  // {{#F}}..{{/F}} and {{^F}}..{{/F}}; innermost first
  const re = /\{\{([#^])([^}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl))) {
    const [all, kind, name, body] = m;
    const v = ctx.fields[name!.trim()] ?? '';
    const present = !!stripHtml(v) || (ctx.clozeOrd !== undefined && name!.startsWith('c') && Number(name!.slice(1)) === ctx.clozeOrd);
    tpl = tpl.replace(all, (kind === '#') === present ? body! : '');
  }
  return tpl;
}

export function render(tpl: string, ctx: RenderCtx, answer: boolean, front?: string): string {
  return sections(tpl, ctx).replace(/\{\{([^}]+)\}\}/g, (all, name: string) => {
    name = name.trim();
    if (name === 'FrontSide') return front ?? '';
    return value(name, ctx, answer) ?? all;
  });
}

export const soundToAudio = (html: string) =>
  html.replace(/\[sound:([^\]]+)\]/g, (_, f) => `<audio controls preload="none" src="${f}"></audio>`);

export const hasMath = (html: string) => /\\\(|\\\[|\[\$\]|\[\$\$\]/.test(html);
