import { useEffect, useState } from 'react';
import type { Collection } from '../model/types';
import { deckTree, type DeckRow } from '../store/queries';

export function DeckList({ col, onStudy, onOptions, onImport }: { col: Collection; onStudy: (id: number, name: string) => void; onOptions: (id: number, name: string) => void; onImport: () => void }) {
  const [rows, setRows] = useState<DeckRow[]>();
  useEffect(() => { deckTree(col, new Date()).then(setRows); }, [col]);
  return (
    <div className="page">
      <header><h1>Decks</h1><button onClick={onImport}>Import</button></header>
      {!rows ? <div className="center">Loading…</div> : rows.length === 0 ? <div className="center">No decks. Import an .apkg.</div> : (
        <ul className="decks">
          {rows.map((d) => (
            <li key={d.id} style={{ paddingLeft: 12 + d.depth * 16 }}>
              <span className="name" onClick={() => onStudy(d.id, d.name)}>{d.name.split('::').pop()}</span>
              <span className="counts" onClick={() => onStudy(d.id, d.name)}><b className="new">{d.newCount}</b><b className="learn">{d.learnCount}</b><b className="review">{d.reviewCount}</b></span>
              <button className="gear" title="Deck options" aria-label={`Options for ${d.name}`} onClick={() => onOptions(d.id, d.name)}>⚙</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
