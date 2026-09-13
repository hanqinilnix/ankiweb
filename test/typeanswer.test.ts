// Ported from rslib/src/typeanswer.rs and text.rs tests, plus av tag tests from card_rendering.
import { expect, it } from 'vitest';
import { avRefsToPlayIcons, extractAvTags, stripAvTags } from '../src/render/avtags';
import { decodeEntities, htmlToTextLine, stripHtml, stripHtmlPreservingMediaFilenames } from '../src/render/text';
import { compareAnswer, Diff, stripExpected } from '../src/render/typeanswer';

const tok = (kind: 'typeGood' | 'typeBad' | 'typeMissed', text: string) => ({ kind, text });
const good = (t: string) => tok('typeGood', t), bad = (t: string) => tok('typeBad', t), missing = (t: string) => tok('typeMissed', t);

it('tokens', () => {
  const o = new Diff('¿Y ahora qué vamos a hacer?', 'y ahora qe vamosa hacer').toTokens();
  expect(o.typed).toEqual([bad('y'), good(' ahora q'), bad('e'), good(' vamos'), missing('-'), good('a hacer'), missing('-')]);
  expect(o.expected).toEqual([missing('¿Y'), good(' ahora q'), missing('ué'), good(' vamos'), missing(' '), good('a hacer'), missing('?')]);
});
it('html_and_media', () => {
  const s = stripExpected('[sound:foo.mp3]<b>1</b> &nbsp;2');
  expect(new Diff(s, '1  2').toTokens().expected).toEqual([good('1  2')]);
});
it('missed chars', () => {
  expect(new Diff('1', '23').toTokens().typed).toEqual([bad('23')]);
  expect(new Diff('12', '1').toTokens().typed).toEqual([good('1'), missing('-')]);
  expect(new Diff('нос', 'нс').toTokens().typed).toEqual([good('н'), missing('-'), good('с')]);
  expect(new Diff('쓰다듬다', '스다뜸다').toTokens().typed).toEqual([bad('스'), good('다'), bad('뜸'), good('다')]);
  new Diff('Сущность должна быть ответственна только за одно дело', 'Single responsibility Сущность выполняет только одну задачу.Повод для изменения сущности только один.').toTokens();
});
it('html output', () => {
  expect(stripExpected('<div>123</div>')).toBe('123');
  expect(new Diff('123', '123').toHtml()).toBe('<code id=typeans><span class=typeGood>123</span></code>');
  expect(compareAnswer('<div>123</div>', '', true)).toBe('<code id=typeans>123</code>');
  expect(new Diff('source <dir>/bin/activate', 'source <dir>/bin/activate').toHtml()).toBe('<code id=typeans><span class=typeGood>source &lt;dir&gt;/bin/activate</span></code>');
  expect(new Diff('123', '1123').toHtml()).toBe('<code id=typeans><span class=typeBad>1</span><span class=typeGood>123</span><br><span id=typearrow>&darr;</span><br><span class=typeGood>123</span></code>');
});
it('noncombining', () => {
  expect(compareAnswer('שִׁנּוּן', 'שנון', false)).toBe('<code id=typeans><span class=typeGood>שִׁנּוּן</span></code>');
  expect(compareAnswer('חוֹף', 'חופ', false)).toBe('<code id=typeans><span class=typeGood>חו</span><span class=typeBad>פ</span><br><span id=typearrow>&darr;</span><br><span class=typeGood>חוֹ</span><span class=typeMissed>ף</span></code>');
  expect(compareAnswer('ば', 'は', false)).toBe('<code id=typeans><span class=typeGood>ば</span></code>');
});

it('text stripping', () => {
  expect(stripHtml('test')).toBe('test');
  expect(stripHtml('t<b>e</b>st')).toBe('test');
  expect(stripHtml('so<SCRIPT>t<b>e</b>st</script>me')).toBe('some');
  expect(stripHtmlPreservingMediaFilenames('<img src=foo.jpg>')).toBe(' foo.jpg ');
  expect(stripHtmlPreservingMediaFilenames("<img src='foo.jpg'><html>")).toBe(' foo.jpg ');
  expect(stripHtmlPreservingMediaFilenames('<html>')).toBe('');
  expect(decodeEntities('a&amp;b&#65;&#x42;&nbsp;')).toBe('a&bAB ');
  expect(htmlToTextLine('a<br>b [sound:x.mp3] [[type:F]]<div>c</div>', true)).toBe('a b x.mp3  c');
});

it('av tags', () => {
  expect(stripAvTags('foo [sound:bar] baz')).toBe('foo  baz');
  expect(stripAvTags('[anki:tts bar=baz]spam[/anki:tts]')).toBe('');
  expect(stripAvTags('[anki:foo bar=baz]spam[/anki:foo]')).toBe('[anki:foo bar=baz]spam[/anki:foo]');
  const [txt, tags] = extractAvTags('foo [sound:bar.mp3] baz [anki:tts lang=en_US][...][/anki:tts]', true);
  expect(txt).toBe('foo [anki:play:q:0] baz [anki:play:q:1]');
  expect(tags).toEqual([{ sound: 'bar.mp3' }, { tts: { text: 'blank', lang: 'en_US', voices: [], speed: 1, other: [] } }]);
  expect(extractAvTags('[anki:tts]foo[/anki:tts]', true)[0]).toContain('Bad directive');
  expect(avRefsToPlayIcons('x [anki:play:q:0]')).toContain(`onclick="pycmd('play:q:0'); return false;"`);
});
