// Port of rslib/src/scheduler/timespan.rs (answer button labels, en-US strings).
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
const MINUTE = 60, HOUR = 3600, DAY = 86400, YEAR = 365 * DAY, MONTH = YEAR / 12;

export function answerButtonTime(seconds: number): string {
  const s = Math.abs(seconds);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  if (s < MINUTE) return `${Math.round(s)}s`;
  if (s < HOUR) return `${Math.round(s / MINUTE)}m`;
  if (s < DAY) return `${r1(s / HOUR)}h`;
  if (s < MONTH) return `${Math.round(s / DAY)}d`;
  if (s < YEAR) return `${r1(s / MONTH)}mo`;
  return `${r1(s / YEAR)}y`;
}

export function answerButtonTimeCollapsible(seconds: number, collapseSecs: number): string {
  const str = answerButtonTime(seconds);
  return seconds === 0 ? '(end)' : seconds < collapseSecs ? `<${str}` : str;
}
