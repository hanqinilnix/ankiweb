// Daily limit scopes, matching Anki's deck options tabs (Preset / This deck / Today only).
import { describe, expect, it } from 'vitest';
import { emptyCommon, emptyNormal, LeechAction, NewGather, NewSort, ReviewMix, ReviewOrder, type Deck, type DeckConfig } from '../src/model/types';
import { activeLimit, parentCap, remainingLimits, setLimit } from '../src/scheduler/limits';

const TODAY = 100;
const cfg = (o: Partial<DeckConfig> = {}): DeckConfig => ({
  id: 1, name: 'Default', newPerDay: 20, revPerDay: 200, learnSteps: [1, 10], relearnSteps: [10], graduatingIvl: 1, easyIvl: 4, startEase: 2.5, maxIvl: 36500,
  hardMult: 1.2, easyMult: 1.3, lapseMult: 0, ivlMult: 1, minLapseIvl: 1, leechThreshold: 8, leechAction: LeechAction.TagOnly, capAnswerSecs: 60,
  buryNew: false, buryReviews: false, buryInterdayLearning: false, newGather: NewGather.Deck, newSort: NewSort.NoSort, reviewOrder: ReviewOrder.Day, newMix: ReviewMix.Mix, interdayMix: ReviewMix.Mix,
  fsrs: false, fsrsParams: [], desiredRetention: 0.9, ...o,
});
const deck = (id: number, name: string, confId = 1): Deck => ({ id, name, confId, common: emptyCommon(), normal: emptyNormal() });

describe('activeLimit', () => {
  it('falls back preset <- deck <- today', () => {
    const c = cfg();
    let d = deck(1, 'a');
    expect(activeLimit(d, c, 'new', TODAY)).toEqual({ scope: 'preset', value: 20 });
    d = { ...d, normal: { ...d.normal, newLimit: 40 } };
    expect(activeLimit(d, c, 'new', TODAY)).toEqual({ scope: 'deck', value: 40 });
    d = { ...d, normal: { ...d.normal, newLimitToday: { limit: 60, today: TODAY } } };
    expect(activeLimit(d, c, 'new', TODAY)).toEqual({ scope: 'today', value: 60 });
    // a today-limit from another day is ignored
    expect(activeLimit(d, c, 'new', TODAY + 1)).toEqual({ scope: 'deck', value: 40 });
    expect(activeLimit(d, c, 'review', TODAY)).toEqual({ scope: 'preset', value: 200 });
  });
});

describe('setLimit', () => {
  const base = { deck: deck(1, 'a'), cfg: cfg() };
  it('preset scope writes the config and clears deck overrides', () => {
    const withDeck = setLimit(base.deck, base.cfg, 'new', 'deck', 40, TODAY);
    const r = setLimit(withDeck.deck, withDeck.cfg, 'new', 'preset', 50, TODAY);
    expect(r.cfg.newPerDay).toBe(50);
    expect(r.deck.normal.newLimit).toBeUndefined();
    expect(r.deck.normal.newLimitToday).toBeUndefined();
    expect(activeLimit(r.deck, r.cfg, 'new', TODAY)).toEqual({ scope: 'preset', value: 50 });
  });
  it('deck scope leaves the preset alone', () => {
    const r = setLimit(base.deck, base.cfg, 'new', 'deck', 40, TODAY);
    expect(r.cfg.newPerDay).toBe(20);
    expect(r.deck.normal.newLimit).toBe(40);
    expect(activeLimit(r.deck, r.cfg, 'new', TODAY)).toEqual({ scope: 'deck', value: 40 });
  });
  it('today scope stamps the day and expires', () => {
    const r = setLimit(base.deck, base.cfg, 'new', 'today', 99, TODAY);
    expect(r.deck.normal.newLimitToday).toEqual({ limit: 99, today: TODAY });
    expect(activeLimit(r.deck, r.cfg, 'new', TODAY).value).toBe(99);
    expect(activeLimit(r.deck, r.cfg, 'new', TODAY + 1).value).toBe(20);
  });
  it('kinds are independent and values are clamped to whole non-negative numbers', () => {
    let r = setLimit(base.deck, base.cfg, 'new', 'deck', 30, TODAY);
    r = setLimit(r.deck, r.cfg, 'review', 'preset', 400, TODAY);
    expect(r.deck.normal.newLimit).toBe(30);
    expect(r.cfg.revPerDay).toBe(400);
    expect(setLimit(base.deck, base.cfg, 'new', 'deck', -5, TODAY).deck.normal.newLimit).toBe(0);
    expect(setLimit(base.deck, base.cfg, 'new', 'deck', 7.6, TODAY).deck.normal.newLimit).toBe(8);
  });
  it('a raised limit reaches the scheduler', () => {
    const r = setLimit(base.deck, base.cfg, 'new', 'deck', 75, TODAY);
    expect(remainingLimits(r.deck, r.cfg, TODAY, false).new).toBe(75);
    const studied = { ...r.deck, common: { ...r.deck.common, lastDayStudied: TODAY, newStudied: 20 } };
    expect(remainingLimits(studied, r.cfg, TODAY, false).new).toBe(55);
  });
});

it('parentCap reports the lowest ancestor limit', () => {
  const decks = [deck(1, 'p'), deck(2, 'p::c', 2), deck(3, 'p::c::g', 3)];
  const cfgs = new Map([[1, cfg({ id: 1, newPerDay: 5 })], [2, cfg({ id: 2, newPerDay: 50 })], [3, cfg({ id: 3, newPerDay: 99 })]]);
  expect(parentCap(decks[2]!, decks, cfgs, 'new', TODAY)).toBe(5);
  expect(parentCap(decks[0]!, decks, cfgs, 'new', TODAY)).toBeUndefined();
  // a deck-level override on the parent counts too
  const withOverride = [decks[0]!, { ...decks[1]!, normal: { ...decks[1]!.normal, newLimit: 2 } }, decks[2]!];
  expect(parentCap(decks[2]!, withOverride, cfgs, 'new', TODAY)).toBe(2);
});
