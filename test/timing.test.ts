// Ported from rslib/src/scheduler/timing.rs tests.
import { expect, it } from 'vitest';
import { schedTimingToday, schedTimingTodayV2New } from '../src/scheduler/timing';

// timestamp of local wall-clock time in a zone `minsWest` of UTC
const ts = (y: number, mo: number, d: number, h: number, minsWest: number, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000 + minsWest * 60;
const elap = (start: number, end: number, sw: number, ew: number, roll: number) => schedTimingTodayV2New(start, sw, end, ew, roll).daysElapsed;

it('days_elapsed', () => {
  const off = -600; // AEST
  const crt = ts(2019, 12, 1, 2, off);
  expect(elap(crt, crt, off, off, 4)).toBe(0);
  expect(elap(crt, crt - 86400, off, off, 4)).toBe(0);
  expect(elap(crt, crt + 24 * 3600, off, off, 4)).toBe(0);
  expect(elap(crt, crt + 26 * 3600, off, off, 4)).toBe(1);
  expect(elap(crt, crt + (26 + 18) * 3600, off, off, 23)).toBe(0);
  expect(elap(crt, crt + (26 + 19) * 3600, off, off, 23)).toBe(1);

  const mdt = 360, mst = 420;
  let c = ts(2018, 8, 6, 0, mdt), n = ts(2019, 12, 26, 20, mst);
  expect(elap(c, n, mdt, mst, 4)).toBe(507);
  expect(elap(c, n, mdt, mdt, 4)).toBe(507);
  c = ts(2018, 8, 6, 3, mdt);
  expect(elap(c, ts(2018, 8, 9, 1, mst, 59, 59), mdt, mst, 4)).toBe(2);
  expect(elap(c, ts(2018, 8, 9, 3, mst, 59, 59), mdt, mst, 4)).toBe(2);
  expect(elap(c, ts(2018, 8, 9, 4, mst), mdt, mst, 4)).toBe(3);

  const hours = [0, 1, 4, 12, 22, 23];
  for (const ch of hours) {
    const crt2 = ts(2018, 8, 6, ch, mdt);
    for (let day = 0; day <= 3; day++) for (const cur of hours) for (const roll of hours) {
      const end = ts(2018, 8, 6 + day, cur, mdt);
      const want = cur < roll ? Math.max(1, day) - 1 : day;
      expect(elap(crt2, end, mdt, mdt, roll)).toBe(want);
    }
  }
});

it('next_day_at', () => {
  const off = 0, roll = 4;
  const crt = ts(2019, 1, 1, 2, off);
  let t = schedTimingTodayV2New(crt, off, ts(2019, 1, 3, 2, off), off, roll);
  expect(t.nextDayAt).toBe(ts(2019, 1, 3, roll, off));
  t = schedTimingTodayV2New(crt, off, ts(2019, 1, 3, roll, off), off, roll);
  expect(t.nextDayAt).toBe(ts(2019, 1, 4, roll, off));
  t = schedTimingTodayV2New(crt, off, ts(2019, 1, 3, roll + 3, off), off, roll);
  expect(t.nextDayAt).toBe(ts(2019, 1, 4, roll, off));
});

it('legacy paths', () => {
  const crt = 1_700_000_000;
  expect(schedTimingToday(crt, crt + 86400 * 3 + 5, undefined, 0, undefined)).toEqual({ now: crt + 86400 * 3 + 5, daysElapsed: 3, nextDayAt: crt + 86400 * 4 });
  const legacy = schedTimingToday(ts(2019, 1, 1, 2, 0), ts(2019, 1, 3, 5, 0), undefined, 0, 4);
  expect(legacy.daysElapsed).toBe(2);
  expect(legacy.nextDayAt).toBe(ts(2019, 1, 4, 4, 0));
});
