// Ported from rslib/src/template.rs and template_filters.rs tests.
import { describe, expect, it } from 'vitest';
import { applyFilters, nonemptyFields, ParsedTemplate, renderCard, TemplateError, type ParsedNode, type RenderContext } from '../src/render/template';
import { fieldIsEmpty } from '../src/render/text';

const T = (text: string): ParsedNode => ({ kind: 'text', text });
const C = (text: string): ParsedNode => ({ kind: 'comment', text });
const R = (key: string, filters: string[] = []): ParsedNode => ({ kind: 'repl', key, filters });
const Cond = (key: string, children: ParsedNode[]): ParsedNode => ({ kind: 'cond', key, children });
const Neg = (key: string, children: ParsedNode[]): ParsedNode => ({ kind: 'neg', key, children });

it('field_empty', () => {
  expect(fieldIsEmpty('')).toBe(true); expect(fieldIsEmpty(' ')).toBe(true); expect(fieldIsEmpty('x')).toBe(false);
  expect(fieldIsEmpty('<BR>')).toBe(true); expect(fieldIsEmpty('<div />')).toBe(true);
  expect(fieldIsEmpty(' <div> <br> </div>\n')).toBe(true); expect(fieldIsEmpty(' <div>x</div>\n')).toBe(false);
});

it('parsing', () => {
  let orig = '';
  expect(ParsedTemplate.fromText(orig).nodes).toEqual([]);
  orig = 'foo {{bar}} {{#baz}} quux {{/baz}}';
  let t = ParsedTemplate.fromText(orig);
  expect(t.nodes).toEqual([T('foo '), R('bar'), T(' '), Cond('baz', [T(' quux ')])]);
  expect(t.toString()).toBe(orig);
  orig = 'foo <!--{{bar }} --> {{#baz}} --> <!-- <!-- {{#def}} --> \u{123}-->\u{456}<!-- 2 --><!----> <!-- quux {{/baz}} <!-- {{nc:abc}}';
  t = ParsedTemplate.fromText(orig);
  expect(t.nodes).toEqual([T('foo '), C('{{bar }} '), T(' '), Cond('baz', [T(' --> '), C(' <!-- {{#def}} '), T(' \u{123}-->\u{456}'), C(' 2 '), C(''), T(' <!-- quux ')]), T(' <!-- '), R('abc', ['nc'])]);
  expect(t.toString()).toBe(orig);
  expect(ParsedTemplate.fromText('{{^baz}}{{/baz}}').nodes).toEqual([Neg('baz', [])]);
  for (const bad of ['{{#mis}}{{/matched}}', '{{/matched}}', '{{#mis}}', '{{#mis}}<!--{{/matched}}-->']) expect(() => ParsedTemplate.fromText(bad)).toThrow(TemplateError);
  for (const ok of ['<!--{{#mis}}{{/matched}}-->', '<!--{{foo}}', '{{foo}}-->']) ParsedTemplate.fromText(ok);
  expect(ParsedTemplate.fromText('{{ tag }}').nodes).toEqual([R('tag')]);
  expect(ParsedTemplate.fromText('text }} more').nodes).toEqual([T('text }} more')]);
  for (const o of ['foo {{one:two}} {{one:two:three}} {{^baz}} {{/baz}} {{foo:}}', 'foo {{one:two}} <!--<!--abc {{^def}}-->--> {{one:two:three}} {{^baz}} <!-- {{/baz}} 🙂 --> {{/baz}} {{foo:}}'])
    expect(ParsedTemplate.fromText(o).toString()).toBe(o);
});

it('nonempty', () => {
  const f = new Set(['1', '3']);
  expect(ParsedTemplate.fromText('{{2}}{{1}}').rendersWithFields(f)).toBe(true);
  expect(ParsedTemplate.fromText('{{2}}').rendersWithFields(f)).toBe(false);
  expect(ParsedTemplate.fromText('{{2}}{{4}}').rendersWithFields(f)).toBe(false);
  expect(ParsedTemplate.fromText('{{#3}}{{^2}}{{1}}{{/2}}{{/3}}').rendersWithFields(f)).toBe(true);
  expect(ParsedTemplate.fromText('{{^1}}{{3}}{{/1}}').rendersWithFields(f)).toBe(false);
});

it('alt_syntax', () => {
  expect(ParsedTemplate.fromText('\n{{=<% %>=}}\n<%Front%>\n<% #Back %>\n<%/Back%>').nodes).toEqual([T('\n'), R('Front'), T('\n'), Cond('Back', [T('\n')])]);
  expect(ParsedTemplate.fromText('\n{{=<% %>=}}\n{{#foo}}\n<%Front%>\n{{/foo}}\n').nodes).toEqual([T('\n{{#foo}}\n'), R('Front'), T('\n{{/foo}}\n')]);
});

describe('render', () => {
  const fields = { F: 'f', B: 'b', E: ' ', c1: '1' };
  const rc = (qfmt: string) => renderCard({ qfmt, afmt: '', fields, cardOrd: 1, isCloze: false, browser: true });
  it('render_single', () => {
    expect(rc('{{B}}A{{F}}').q).toBe('bAf');
    expect(rc('{{#E}}A{{/E}}').q).toBe('');
    expect(rc('{{#E}}}{{^M}}A{{/M}}{{/E}}}').q).toContain('noSuchConditional: ^M');
    expect(rc('{{^E}}1{{#F}}2{{#B}}{{F}}{{/B}}{{/F}}{{/E}}').q).toBe('12f');
    expect(rc('{{^E}}1<!--{{#F}}2{{#B}}{{F}}{{/B}}{{/F}}-->\u{123}<!-- this is a comment -->{{/E}}\u{456}').q).toBe('1<!--{{#F}}2{{#B}}{{F}}{{/B}}{{/F}}-->\u{123}<!-- this is a comment -->\u{456}');
    expect(rc('{{^c2}}1{{#c1}}2{{/c1}}{{/c2}}').q).toBe('12');
    expect(rc('{{Nope}}').q).toContain('fieldNotFound');
  });
  it('frontside and empty front', () => {
    const r = renderCard({ qfmt: '{{F}}', afmt: '{{FrontSide}}<hr id=answer>{{B}}', fields, cardOrd: 0, isCloze: false });
    expect(r).toEqual({ q: 'f', a: 'f<hr id=answer>b', isEmpty: false });
    const e = renderCard({ qfmt: '{{E}}', afmt: '{{B}}', fields, cardOrd: 0, isCloze: false });
    expect(e.isEmpty).toBe(true); expect(e.q).toContain('front of this card is blank');
    const c = renderCard({ qfmt: '{{cloze:Text}}', afmt: '', fields: { Text: '{{c1::a}}' }, cardOrd: 1, isCloze: true });
    expect(c.isEmpty).toBe(true); expect(c.q).toContain('Cloze 2 does not exist');
  });
  it('cloze filter both sides', () => {
    const r = renderCard({ qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}', fields: { Text: 'The {{c1::sky}} is {{c2::blue::colour}}', Extra: 'x' }, cardOrd: 1, isCloze: true });
    expect(r.q).toBe('The <span class="cloze-inactive" data-ordinal="1">sky</span> is <span class="cloze" data-cloze="blue" data-ordinal="2">[colour]</span>');
    expect(r.a).toBe('The <span class="cloze-inactive" data-ordinal="1">sky</span> is <span class="cloze" data-ordinal="2">blue</span><br>x');
  });
});

describe('filters', () => {
  const ctx: RenderContext = { fields: {}, nonempty: new Set(), cardOrd: 0, frontside: '' };
  it('furigana', () => {
    expect(applyFilters('test first[second] third[fourth]', ['kana'], 'F', ctx)).toBe('testsecondfourth');
    expect(applyFilters('test first[second] third[fourth]', ['kanji'], 'F', ctx)).toBe('testfirstthird');
    expect(applyFilters('first[second]', ['furigana'], 'F', ctx)).toBe('<ruby><rb>first</rb><rt>second</rt></ruby>');
  });
  it('typing', () => {
    expect(applyFilters('ignored', ['cloze', 'type'], 'Text', ctx)).toBe('[[type:cloze:Text]]');
    expect(applyFilters('ignored', ['nc', 'type'], 'Text', ctx)).toBe('[[type:nc:Text]]');
    expect(applyFilters('ignored', ['some', 'unknown', 'type'], 'Text', ctx)).toBe('[[type:Text]]');
  });
  it('hint and text', () => {
    const h = applyFilters('foo', ['hint'], 'field', ctx);
    expect(h).toContain('<a class=hint'); expect(h).toContain('class=hint style="display: none">foo</div>');
    expect(applyFilters('a<b>b</b>&amp;', ['text'], 'F', ctx)).toBe('ab&');
    expect(applyFilters('x', ['tts en_US'], 'F', ctx)).toBe('[anki:tts lang=en_US]x[/anki:tts]');
    expect(nonemptyFields({ a: '', b: '<br>', c: 'x' })).toEqual(new Set(['c']));
  });
});
