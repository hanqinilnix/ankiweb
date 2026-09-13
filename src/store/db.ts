import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { emptyCommon, emptyNormal, type Card, type Collection, type Deck, type DeckConfig, type Media, type Note, type NoteType, type RevlogEntry } from '../model/types';

interface Schema extends DBSchema {
  col: { key: 'col'; value: Collection };
  notetypes: { key: number; value: NoteType };
  decks: { key: number; value: Deck };
  dconf: { key: number; value: DeckConfig };
  notes: { key: number; value: Note; indexes: { guid: string } };
  cards: { key: number; value: Card; indexes: { nid: number; did: number; 'did-queue': [number, number] } };
  revlog: { key: number; value: RevlogEntry; indexes: { cid: number } };
  media: { key: string; value: Media };
}
export type DB = IDBPDatabase<Schema>;

let db: Promise<DB> | undefined;
export const getDB = () =>
  (db ??= openDB<Schema>('anki-local', 2, {
    async upgrade(d, oldVersion, _new, tx) {
      if (oldVersion < 1) {
        d.createObjectStore('col');
        d.createObjectStore('notetypes', { keyPath: 'id' });
        d.createObjectStore('decks', { keyPath: 'id' });
        d.createObjectStore('dconf', { keyPath: 'id' });
        d.createObjectStore('notes', { keyPath: 'id' }).createIndex('guid', 'guid', { unique: true });
        const c = d.createObjectStore('cards', { keyPath: 'id' });
        c.createIndex('nid', 'nid'); c.createIndex('did', 'did'); c.createIndex('did-queue', ['did', 'queue']);
        d.createObjectStore('revlog', { keyPath: 'id' }).createIndex('cid', 'cid');
        d.createObjectStore('media', { keyPath: 'name' });
      }
      if (oldVersion < 2 && oldVersion > 0) {
        const decks = tx.objectStore('decks');
        for (const dk of await decks.getAll()) await decks.put({ ...dk, common: dk.common ?? emptyCommon(), normal: dk.normal ?? emptyNormal() });
        const col = await tx.objectStore('col').get('col');
        if (col) await tx.objectStore('col').put({ ...({ learnAheadSecs: 1200, newCardsIgnoreReviewLimit: false, applyAllParentLimits: false, lastUnburiedDay: 0 } as Partial<Collection>), ...col } as Collection, 'col');
      }
    },
  }));

export async function clearAll() {
  const d = await getDB();
  const names = ['col', 'notetypes', 'decks', 'dconf', 'notes', 'cards', 'revlog', 'media'] as const;
  const tx = d.transaction(names, 'readwrite');
  await Promise.all([...names.map((n) => tx.objectStore(n).clear()), tx.done]);
}
