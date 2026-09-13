// Ported from rslib/src/cloze.rs tests.
import { expect, it } from 'vitest';
import { clozeNumberInFields, clozeNumbersInString, extractClozeForTyping, revealClozeText, revealClozeTextOnly, stripClozes, stripHtmlInsideMathjax } from '../src/render/cloze';
import { encodeAttribute, stripHtml } from '../src/render/text';

const set = (...n: number[]) => new Set(n);

it('cloze numbers', () => {
  expect(clozeNumbersInString('test')).toEqual(set());
  expect(clozeNumbersInString('{{c2::te}}{{c1::s}}t{{')).toEqual(set(1, 2));
  expect(clozeNumbersInString('{{c0::te}}s{{c2::t}}s')).toEqual(set(2));
  expect(clozeNumbersInString('öaöaöööaö')).toEqual(set());
  expect(clozeNumberInFields(['{{c1,2,3::multi}}'])).toEqual(set(1, 2, 3));
  expect(clozeNumbersInString('{{c1,1,2::test}}')).toEqual(set(1, 2));
  expect(clozeNumbersInString('{{c0,1,2::test}}')).toEqual(set(1, 2));
  expect(clozeNumbersInString('{{c1,,3::test}}')).toEqual(set(1, 3));
  expect(clozeNumbersInString('{{c2::te{{c1::s}}}}t{{')).toEqual(set(1, 2));
});

it('cloze_only', () => {
  expect(revealClozeTextOnly('foo', 1, true)).toBe('');
  expect(revealClozeTextOnly('foo {{c1::bar}}', 1, true)).toBe('...');
  expect(revealClozeTextOnly('foo {{c1::bar::baz}}', 1, true)).toBe('baz');
  expect(revealClozeTextOnly('foo {{c1::bar}}', 1, false)).toBe('bar');
  expect(revealClozeTextOnly('foo {{c1::bar}}', 2, false)).toBe('');
  expect(revealClozeTextOnly('{{c1::foo}} {{c1::bar}}', 1, false)).toBe('foo, bar');
});

it('clozes_for_typing', () => {
  expect(extractClozeForTyping('{{c2::foo}}', 1)).toBe('');
  expect(extractClozeForTyping('{{c1::foo}} {{c1::bar}} {{c1::foo}}', 1)).toBe('foo, bar, foo');
  expect(extractClozeForTyping('{{c1::foo}} {{c1::foo}} {{c1::foo}}', 1)).toBe('foo');
});

it('nested_cloze_plain_text', () => {
  const s = (t: string, o: number, q: boolean) => stripHtml(revealClozeText(t, o, q));
  expect(s('foo {{c1::bar {{c2::baz}}}}', 1, true)).toBe('foo [...]');
  expect(s('foo {{c1::bar {{c2::baz}}}}', 1, false)).toBe('foo bar baz');
  expect(s('foo {{c1::bar {{c2::baz}}::qux}}', 2, true)).toBe('foo bar [...]');
  expect(s('foo {{c1::bar {{c2::baz}}::qux}}', 2, false)).toBe('foo bar baz');
  expect(s('foo {{c1::bar {{c2::baz}}::qux}}', 1, true)).toBe('foo [qux]');
  expect(s('foo {{c1::bar {{c2::baz}}::qux}}', 1, false)).toBe('foo bar baz');
});

it('nested_cloze_html', () => {
  const inner = encodeAttribute('bar <span class="cloze-inactive" data-ordinal="2">baz</span>');
  expect(revealClozeText('foo {{c1::bar {{c2::baz}}}}', 1, true)).toBe(`foo <span class="cloze" data-cloze="${inner}" data-ordinal="1">[...]</span>`);
  expect(revealClozeText('foo {{c1::bar {{c2::baz}}}}', 1, false)).toBe('foo <span class="cloze" data-ordinal="1">bar <span class="cloze-inactive" data-ordinal="2">baz</span></span>');
  expect(revealClozeText('foo {{c1::bar {{c2::baz}}::qux}}', 2, true)).toBe('foo <span class="cloze-inactive" data-ordinal="1">bar <span class="cloze" data-cloze="baz" data-ordinal="2">[...]</span></span>');
  expect(revealClozeText('foo {{c1::bar {{c2::baz}}::qux}}', 2, false)).toBe('foo <span class="cloze-inactive" data-ordinal="1">bar <span class="cloze" data-ordinal="2">baz</span></span>');
  expect(revealClozeText('foo {{c1::bar {{c2::baz}}::qux}}', 1, true)).toBe(`foo <span class="cloze" data-cloze="${inner}" data-ordinal="1">[qux]</span>`);
});

it('multi card', () => {
  const text = '{{c1,2::shared}} word and {{c1::first}} vs {{c2::second}}';
  const s = (o: number, q: boolean) => stripHtml(revealClozeText(text, o, q));
  expect(s(1, true)).toBe('[...] word and [...] vs second');
  expect(s(2, true)).toBe('[...] word and first vs [...]');
  expect(s(1, false)).toBe('shared word and first vs second');
  expect(clozeNumbersInString(text)).toEqual(set(1, 2));
  expect(revealClozeText('{{c1,2,3::multi}}', 2, true)).toContain('data-ordinal="1,2,3"');
  expect(stripHtml(revealClozeText('{{c1,2::answer::hint}}', 2, true))).toBe('[hint]');
  expect(stripHtml(revealClozeText('{{c1,2::answer::hint}}', 1, false))).toBe('answer');
  const t2 = '{{c1,2::shared}} and {{c1::first}} vs {{c2::second}}';
  expect(revealClozeTextOnly(t2, 1, true)).toBe('..., ...');
  expect(revealClozeTextOnly(t2, 2, false)).toBe('shared, second');
  expect(stripHtml(revealClozeText('{{c1,2::outer {{c3::inner}}}}', 3, true))).toBe('outer [...]');
  expect(stripHtml(revealClozeText('{{c1::outer {{c1::inner}}}}', 1, true))).toBe('[...]');
  expect(revealClozeText('no cloze here', 1, true)).toBe('');
});

it('strip and mathjax', () => {
  expect(stripClozes('The {{c1::moon::🌛}} {{c2::orbits::this hint has "::" in it}} the {{c3::🌏}}.')).toBe('The moon orbits the 🌏.');
  expect(stripHtmlInsideMathjax('\\(<foo>&lt;&gt;</foo>\\)')).toBe('\\(&lt;&gt;\\)');
});
