export type Id = number;

export interface Field { name: string; ord: number }
export interface Template { name: string; ord: number; qfmt: string; afmt: string }
export interface NoteType {
  id: Id; name: string; type: 0 | 1; // 0 standard, 1 cloze
  fields: Field[]; templates: Template[]; css: string;
}
export interface Deck { id: Id; name: string; confId: Id; parentId?: Id }
export interface Note { id: Id; guid: string; mid: Id; mod: number; tags: string[]; fields: string[] }

export enum CardType { New = 0, Learn = 1, Review = 2, Relearn = 3 }
export enum Queue { SchedBuried = -3, UserBuried = -2, Suspended = -1, New = 0, Learn = 1, Review = 2, DayLearn = 3, Preview = 4 }

export interface FsrsState { s: number; d: number }
export interface Card {
  id: Id; nid: Id; did: Id; ord: number;
  type: CardType; queue: Queue;
  due: number; // new: position; learn: epoch s; review: days since col.crt
  ivl: number; factor: number; reps: number; lapses: number; left: number;
  odue: number; odid: Id; flags: number;
  fsrs?: FsrsState;
}
export enum Rating { Again = 1, Hard = 2, Good = 3, Easy = 4 }
export enum RevlogType { Learn = 0, Review = 1, Relearn = 2, Filtered = 3, Manual = 4 }
export interface RevlogEntry {
  id: Id; cid: Id; ease: Rating; ivl: number; lastIvl: number; factor: number; time: number; type: RevlogType;
}
export interface DeckConfig {
  id: Id; name: string;
  newPerDay: number; revPerDay: number;
  learnSteps: number[]; relearnSteps: number[]; // minutes
  graduatingIvl: number; easyIvl: number; startEase: number; maxIvl: number;
  fsrs: boolean; fsrsParams: number[]; desiredRetention: number;
}
export interface Collection { crt: number; rollover: number; fsrs: boolean }
export interface Media { name: string; blob: Blob }
