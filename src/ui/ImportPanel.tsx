import { useEffect, useState } from 'react';
import { gdriveAvailable, pickGDriveFile, prepareGDrive, setGDriveConfig } from '../cloud/gdrive';
import { acceptAttr, isIOS, looksLikePackage } from '../cloud/local';
import type { Progress } from '../import';
import { runImport } from '../import/run';
import { clearAll } from '../store/db';

const label = (p: Progress) => (p.done ? `${p.stage} ${p.done}/${p.total}` : p.stage);
const mb = (n: number) => `${(n / 1e6).toFixed(1)}MB`;

export function ImportPanel({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [drive, setDrive] = useState(gdriveAvailable());

  // Prepared up front so the OAuth popup opens inside the click handler (iOS blocks it otherwise).
  useEffect(() => { if (drive) prepareGDrive().catch((e) => setError(String(e.message ?? e))); }, [drive]);

  const importBytes = async (bytes: Uint8Array, name?: string) => {
    setBusy(true); setError(undefined); setStatus(`reading ${name ?? 'file'} (${mb(bytes.length)})`);
    try {
      const r = await runImport(bytes, (p) => setStatus(label(p)));
      setStatus(`imported ${r.notes} notes, ${r.cards} cards, ${r.media} media`);
      setTimeout(onDone, 800);
    } catch (e) {
      setStatus(undefined);
      setError(`Import failed: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const onFile = async (f: File | undefined | null) => {
    if (!f) return;
    if (!looksLikePackage(f.name)) { setError(`${f.name} is not an .apkg or .colpkg file.`); return; }
    setStatus(`opening ${f.name}`);
    try { await importBytes(new Uint8Array(await f.arrayBuffer()), f.name); }
    catch (e) { setStatus(undefined); setError(`Could not read ${f.name}: ${(e as Error).message}`); }
  };

  const fromDrive = async () => {
    setBusy(true); setError(undefined); setStatus('opening Google Drive…');
    try {
      const bytes = await pickGDriveFile((l, t) => setStatus(`downloading ${mb(l)}${t ? ` / ${mb(t)}` : ''}`));
      setBusy(false);
      if (!bytes) { setStatus(undefined); return; }
      await importBytes(bytes, 'Drive file');
    } catch (e) { setBusy(false); setStatus(undefined); setError(`Google Drive: ${(e as Error).message}`); }
  };

  return (
    <div className="page import" onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
      <header><h1>Import</h1>{onCancel && <button onClick={onCancel}>Back</button>}</header>
      <p>Pick an .apkg or .colpkg file.{isIOS() && ' In the Files app, tap Browse to reach iCloud Drive, Google Drive, or Dropbox.'}</p>

      {/* A real input plus a label: iOS opens this reliably, a scripted .click() does not always. */}
      <input id="pick-file" type="file" accept={acceptAttr() || undefined} disabled={busy}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <label htmlFor="pick-file" className={`btn${busy ? ' disabled' : ''}`}>
        Choose file{isIOS() ? ' (Files, iCloud, Drive)' : ''}
      </label>

      {drive
        ? <button disabled={busy} onClick={fromDrive}>Google Drive (direct)</button>
        : <button onClick={() => setShowConfig((v) => !v)}>Set up Google Drive…</button>}

      {showConfig && !drive && (
        <form className="gdrive-config" onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget as HTMLFormElement & { clientId: HTMLInputElement; apiKey: HTMLInputElement };
          if (!f.clientId.value.trim()) return;
          setGDriveConfig(f.clientId.value, f.apiKey.value);
          setDrive(true); setShowConfig(false);
        }}>
          <p>Direct Drive access needs your own Google OAuth client. Without it, open Drive files through the Files app instead.</p>
          <input name="clientId" placeholder="OAuth client ID (…apps.googleusercontent.com)" autoComplete="off" />
          <input name="apiKey" placeholder="API key (optional, for the picker)" autoComplete="off" />
          <button type="submit">Save</button>
        </form>
      )}

      {status && <p className="status">{status}</p>}
      {error && <p className="status error">{error}</p>}
      <details><summary>Danger</summary><button disabled={busy} onClick={async () => { if (confirm('Delete all local data?')) { await clearAll(); location.reload(); } }}>Erase everything</button></details>
    </div>
  );
}
