// Port of rslib/src/scheduler/timing.rs
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import type { Collection } from '../model/types';

export interface SchedTimingToday { now: number; daysElapsed: number; nextDayAt: number }

const DAY = 86400;
// Wall-clock fields of `secs` in a fixed offset (minutes west of UTC).
const local = (secs: number, minsWest: number) => new Date((secs - minsWest * 60) * 1000);
const daysFromCe = (d: Date) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);

function rolloverSecs(secs: number, minsWest: number, rolloverHour: number): number {
  const d = local(secs, minsWest);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), rolloverHour % 24) / 1000 + minsWest * 60;
}

export function schedTimingTodayV2New(crt: number, crtMinsWest: number, now: number, nowMinsWest: number, rollover: number): SchedTimingToday {
  const rolloverToday = rolloverSecs(now, nowMinsWest, rollover);
  const rolloverPassed = rolloverToday <= now;
  const nextDayAt = rolloverPassed ? rolloverToday + DAY : rolloverToday;
  let days = daysFromCe(local(now, nowMinsWest)) - daysFromCe(local(crt, crtMinsWest));
  if (!rolloverPassed) days -= 1;
  return { now, daysElapsed: Math.max(0, days), nextDayAt };
}

function schedTimingTodayV1(crt: number, now: number): SchedTimingToday {
  const daysElapsed = Math.floor((now - crt) / DAY);
  return { now, daysElapsed, nextDayAt: crt + (daysElapsed + 1) * DAY };
}

function schedTimingTodayV2Legacy(crt: number, rollover: number, now: number, nowMinsWest: number): SchedTimingToday {
  const crtAtRollover = rolloverSecs(crt, nowMinsWest, rollover);
  const daysElapsed = Math.floor((now - crtAtRollover) / DAY);
  let nextDayAt = rolloverSecs(now, nowMinsWest, rollover);
  if (nextDayAt < now) nextDayAt += DAY;
  return { now, daysElapsed, nextDayAt };
}

export function schedTimingToday(crt: number, now: number, crtMinsWest: number | undefined, nowMinsWest: number, rollover: number | undefined): SchedTimingToday {
  if (rollover === undefined) return schedTimingTodayV1(crt, now);
  if (crtMinsWest === undefined) return schedTimingTodayV2Legacy(crt, rollover, now, nowMinsWest);
  return schedTimingTodayV2New(crt, crtMinsWest, now, nowMinsWest, rollover);
}

export const localMinutesWest = (d: Date) => d.getTimezoneOffset();

export function timingFor(col: Collection, now: Date): SchedTimingToday {
  return schedTimingToday(col.crt, Math.floor(now.getTime() / 1000), col.creationOffset, localMinutesWest(now), col.rollover);
}
