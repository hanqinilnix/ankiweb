export type Id = number;

export interface Field { name: string; ord: number; font?: string; size?: number }
export interface Template { name: string; ord: number; qfmt: string; afmt: string }
export interface NoteType {
  id: Id; name: string; type: 0 | 1; // 0 standard, 1 cloze
  fields: Field[]; templates: Template[]; css: string;
}

// Port of anki_proto Deck.Common / Deck.Normal (rslib/src/decks).
export interface DeckCommon { lastDayStudied: number; newStudied: number; reviewStudied: number; learningStudied: number; msStudied: number }
export interface DayLimit { limit: number; today: number }
export interface DeckNormal {
  extendNew: number; extendReview: number;
  reviewLimit?: number; newLimit?: number; reviewLimitToday?: DayLimit; newLimitToday?: DayLimit;
}
export interface Deck { id: Id; name: string; confId: Id; parentId?: Id; common: DeckCommon; normal: DeckNormal }
export const emptyCommon = (): DeckCommon => ({ lastDayStudied: 0, newStudied: 0, reviewStudied: 0, learningStudied: 0, msStudied: 0 });
export const emptyNormal = (): DeckNormal => ({ extendNew: 0, extendReview: 0 });

export interface Note { id: Id; guid: string; mid: Id; mod: number; tags: string[]; fields: string[] }

export enum CardType { New = 0, Learn = 1, Review = 2, Relearn = 3 }
export enum Queue { SchedBuried = -3, UserBuried = -2, Suspended = -1, New = 0, Learn = 1, Review = 2, DayLearn = 3, Preview = 4 }

export interface FsrsState { s: number; d: number }
export interface Card {
  id: Id; nid: Id; did: Id; ord: number; mod: number;
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

// anki_proto DeckConfig.Config enums
export enum NewGather { Deck = 0, LowestPosition = 1, HighestPosition = 2, RandomNotes = 3, RandomCards = 4, DeckThenRandomNotes = 5 }
export enum NewSort { Template = 0, NoSort = 1, TemplateThenRandom = 2, RandomNoteThenTemplate = 3, RandomCard = 4 }
export enum ReviewOrder { Day = 0, DayThenDeck = 1, DeckThenDay = 2, IvlAsc = 3, IvlDesc = 4, EaseAsc = 5, EaseDesc = 6, RetrAsc = 7, Random = 8, Added = 9, ReverseAdded = 10, RetrDesc = 11, RelativeOverdue = 12 }
export enum ReviewMix { Mix = 0, After = 1, Before = 2 }
export enum LeechAction { Suspend = 0, TagOnly = 1 }

export interface DeckConfig {
  id: Id; name: string;
  newPerDay: number; revPerDay: number;
  learnSteps: number[]; relearnSteps: number[]; // minutes
  graduatingIvl: number; easyIvl: number; startEase: number; maxIvl: number;
  hardMult: number; easyMult: number; lapseMult: number; ivlMult: number; minLapseIvl: number; leechThreshold: number;
  leechAction: LeechAction; capAnswerSecs: number;
  buryNew: boolean; buryReviews: boolean; buryInterdayLearning: boolean;
  newGather: NewGather; newSort: NewSort; reviewOrder: ReviewOrder; newMix: ReviewMix; interdayMix: ReviewMix;
  fsrs: boolean; fsrsParams: number[]; desiredRetention: number;
}
export interface Collection {
  crt: number; rollover: number; fsrs: boolean;
  creationOffset?: number; // minutes west of UTC at creation; absent = legacy cutoff
  learnAheadSecs: number; newCardsIgnoreReviewLimit: boolean; applyAllParentLimits: boolean;
  lastUnburiedDay: number;
}
export interface Media { name: string; blob: Blob }
