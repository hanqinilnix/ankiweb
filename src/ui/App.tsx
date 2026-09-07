import { useEffect, useState } from 'react';
import type { Collection } from '../model/types';
import { loadCol } from '../store/queries';
import { DeckList } from './DeckList';
import { ImportPanel } from './ImportPanel';
import { Reviewer } from './Reviewer';

type View = { name: 'decks' } | { name: 'review'; deckId: number; deckName: string } | { name: 'import' };

export function App() {
  const [col, setCol] = useState<Collection | null | undefined>();
  const [view, setView] = useState<View>({ name: 'decks' });
  const reload = () => loadCol().then((c) => setCol(c ?? null));
  useEffect(() => { reload(); }, []);

  if (col === undefined) return <div className="center">Loading…</div>;
  if (view.name === 'import' || col === null)
    return <ImportPanel onDone={() => { reload(); setView({ name: 'decks' }); }} onCancel={col ? () => setView({ name: 'decks' }) : undefined} />;
  if (view.name === 'review')
    return <Reviewer col={col} deckId={view.deckId} deckName={view.deckName} onExit={() => setView({ name: 'decks' })} />;
  return <DeckList col={col} onStudy={(deckId, deckName) => setView({ name: 'review', deckId, deckName })} onImport={() => setView({ name: 'import' })} />;
}
