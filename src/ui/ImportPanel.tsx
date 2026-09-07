import { useState } from 'react';
import { gdriveAvailable, pickGDriveFile } from '../cloud/gdrive';
import { pickLocalFile } from '../cloud/local';
import type { Progress } from '../import';
import { runImport } from '../import/run';
import { clearAll } from '../store/db';

const label = (p: Progress) => p.done ? `${p.stage} ${p.done}/${p.total}` : p.stage;

export function ImportPanel({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (get: () => Promise<Uint8Array | undefined>) => {
    setBusy(true); setStatus('picking…');
    try {
      const bytes = await get();
      if (!bytes) { setStatus(undefined); return; }
      const r = await runImport(bytes, (p) => setStatus(label(p)));
      setStatus(`imported ${r.notes} notes, ${r.cards} cards, ${r.media} media`);
      setTimeout(onDone, 800);
    } catch (e) { setStatus(`error: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  const local = async () => { const f = await pickLocalFile(); return f && new Uint8Array(await f.arrayBuffer()); };
  const gdrive = () => pickGDriveFile((l, t) => setStatus(`downloading ${(l / 1e6).toFixed(1)}MB${t ? ` / ${(t / 1e6).toFixed(1)}MB` : ''}`));

  return (
    <div className="page import" onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) run(async () => new Uint8Array(await f.arrayBuffer())); }}>
      <header><h1>Import</h1>{onCancel && <button onClick={onCancel}>Back</button>}</header>
      <p>Pick an .apkg or .colpkg. On iPhone the file picker includes iCloud Drive.</p>
      <button disabled={busy} onClick={() => run(local)}>Local / iCloud Drive</button>
      <button disabled={busy || !gdriveAvailable} onClick={() => run(gdrive)} title={gdriveAvailable ? '' : 'set VITE_GOOGLE_CLIENT_ID'}>Google Drive</button>
      {status && <p className="status">{status}</p>}
      <details><summary>Danger</summary><button disabled={busy} onClick={async () => { if (confirm('Delete all local data?')) { await clearAll(); location.reload(); } }}>Erase everything</button></details>
    </div>
  );
}
