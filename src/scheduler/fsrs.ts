// Port of fsrs-rs 6.6.2 inference.rs/model.rs forward pass (next_states, next_interval, memory_state_from_sm2).
// Copyright: Open Spaced Repetition contributors; Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later (this port); fsrs-rs is BSD-3-Clause.
export const FSRS5_DEFAULT_DECAY = 0.5, FSRS6_DEFAULT_DECAY = 0.1542;
export const DEFAULT_PARAMETERS = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, FSRS6_DEFAULT_DECAY];
const S_MIN = 0.001, S_MAX = 36500, D_MIN = 1, D_MAX = 10;

export interface MemoryState { stability: number; difficulty: number }
export interface ItemState { memory: MemoryState; interval: number }
export interface NextStates { again: ItemState; hard: ItemState; good: ItemState; easy: ItemState }

// FSRS::new: 17 (v4.5) and 19 (v5) parameter sets are extended to 21.
export function fillParameters(p: number[]): number[] {
  if (p.length === 0) return [...DEFAULT_PARAMETERS];
  const w = [...p];
  if (w.length === 17) w.push(0, 0);
  if (w.length === 19) w.push(0, FSRS5_DEFAULT_DECAY);
  if (w.length !== 21) throw new Error(`invalid fsrs params: ${p.length}`);
  return w;
}
export const decayOf = (p: number[]) => (p.length === 0 ? FSRS6_DEFAULT_DECAY : p.length < 21 ? FSRS5_DEFAULT_DECAY : p[20]!);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Fsrs {
  readonly w: number[];
  private decay: number; private factor: number;
  constructor(params: number[]) {
    this.w = fillParameters(params);
    this.decay = -this.w[20]!;
    this.factor = Math.pow(0.9, 1 / this.decay) - 1;
  }
  forgettingCurve(t: number, s: number) { return Math.pow(1 + this.factor * t / s, this.decay); }
  nextIntervalForStability(s: number, dr: number) { return (s / this.factor) * (Math.pow(dr, 1 / this.decay) - 1); }
  initStability(rating: number) { return this.w[clamp(rating, 1, 4) - 1]!; }
  initDifficulty(rating: number) { return this.w[4]! - Math.exp(this.w[5]! * (rating - 1)) + 1; }
  private stabilityAfterSuccess(s: number, d: number, r: number, rating: number) {
    const w = this.w;
    const hard = rating === 2 ? w[15]! : 1, easy = rating === 4 ? w[16]! : 1;
    return s * (Math.exp(w[8]!) * (11 - d) * Math.pow(s, -w[9]!) * (Math.exp((1 - r) * w[10]!) - 1) * hard * easy + 1);
  }
  private stabilityAfterFailure(s: number, d: number, r: number) {
    const w = this.w;
    const ns = w[11]! * Math.pow(d, -w[12]!) * (Math.pow(s + 1, w[13]!) - 1) * Math.exp((1 - r) * w[14]!);
    return Math.min(ns, s / Math.exp(w[17]! * w[18]!));
  }
  private stabilityShortTerm(s: number, rating: number) {
    const w = this.w;
    let sinc = Math.exp(w[17]! * (rating - 3 + w[18]!)) * Math.pow(s, -w[19]!);
    if (rating >= 2) sinc = Math.max(sinc, 1);
    return s * sinc;
  }
  private nextDifficulty(d: number, rating: number) {
    const delta = -this.w[6]! * (rating - 3);
    return d + ((10 - d) * delta) / 9; // linear damping
  }
  private meanReversion(d: number) { return this.w[7]! * (this.initDifficulty(4) - d) + d; }
  step(deltaT: number, rating: number, state: MemoryState, nth: number): MemoryState {
    const lastS = clamp(state.stability, S_MIN, S_MAX), lastD = clamp(state.difficulty, D_MIN, D_MAX);
    const r = this.forgettingCurve(deltaT, lastS);
    let s = rating === 1 ? this.stabilityAfterFailure(lastS, lastD, r) : this.stabilityAfterSuccess(lastS, lastD, r, rating);
    if (deltaT === 0) s = this.stabilityShortTerm(lastS, rating);
    let d = clamp(this.meanReversion(this.nextDifficulty(lastD, rating)), D_MIN, D_MAX);
    if (nth === 0 && state.stability === 0) { s = this.initStability(rating); d = clamp(this.initDifficulty(clamp(rating, 1, 4)), D_MIN, D_MAX); }
    return { stability: clamp(s, S_MIN, S_MAX), difficulty: d };
  }
  nextStates(current: MemoryState | undefined, desiredRetention: number, daysElapsed: number): NextStates {
    const [state, nth] = current ? [current, 1] : [{ stability: 0, difficulty: 0 }, 0];
    const one = (rating: number): ItemState => {
      const memory = this.step(daysElapsed, rating, state, nth);
      if (!isFinite(memory.stability) || !isFinite(memory.difficulty)) throw new Error('fsrs: invalid state');
      return { memory, interval: this.nextIntervalForStability(memory.stability, desiredRetention) };
    };
    return { again: one(1), hard: one(2), good: one(3), easy: one(4) };
  }
  memoryStateFromSm2(easeFactor: number, interval: number, sm2Retention: number): MemoryState | undefined {
    const w = this.w;
    const stability = Math.max(interval, S_MIN) * this.factor / (Math.pow(sm2Retention, 1 / this.decay) - 1);
    const difficulty = 11 - (easeFactor - 1) / (Math.exp(w[8]!) * Math.pow(stability, -w[9]!) * Math.expm1((1 - sm2Retention) * w[10]!));
    if (!isFinite(stability) || !isFinite(difficulty)) return undefined;
    return { stability, difficulty: clamp(difficulty, D_MIN, D_MAX) };
  }
}
