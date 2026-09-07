import { expect, it } from 'vitest';
import { cloze, hasCloze, render, soundToAudio } from '../src/render/template';

const ctx = { fields: { Front: 'Q', Back: 'A', Empty: '', Text: 'The {{c1::sky}} is {{c2::blue::colour}}' }, tags: ['x'], deck: 'D::S' };

it('fields and FrontSide', () => {
  const q = render('{{Front}}', ctx, false);
  expect(q).toBe('Q');
  expect(render('{{FrontSide}}<hr>{{Back}} {{Tags}} {{Subdeck}}', ctx, true, q)).toBe('Q<hr>A x S');
});
it('sections', () => {
  expect(render('{{#Empty}}yes{{/Empty}}{{^Empty}}no{{/Empty}}{{#Front}}f{{/Front}}', ctx, false)).toBe('nof');
});
it('cloze', () => {
  expect(cloze(ctx.fields.Text, 1, false)).toBe('The <span class="cloze">[...]</span> is blue');
  expect(cloze(ctx.fields.Text, 2, false)).toBe('The sky is <span class="cloze">[colour]</span>');
  expect(cloze(ctx.fields.Text, 2, true)).toBe('The sky is <span class="cloze">blue</span>');
  expect(hasCloze(ctx.fields.Text, 3)).toBe(false);
  expect(render('{{cloze:Text}}', { ...ctx, clozeOrd: 1 }, false)).toContain('[...]');
});
it('hint and unknown', () => {
  expect(render('{{hint:Back}}', ctx, false)).toContain('<details');
  expect(render('{{Nope}}', ctx, false)).toBe('{{Nope}}');
});
it('sound', () => {
  expect(soundToAudio('a [sound:x.mp3] b')).toContain('<audio controls preload="none" src="x.mp3">');
});
