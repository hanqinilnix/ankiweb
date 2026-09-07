// Google Drive via GIS token client + Picker. Scope drive.file: only files the user picks.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
export const gdriveAvailable = !!CLIENT_ID;

declare const google: any;
declare const gapi: any;

const script = (src: string) => new Promise<void>((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) return res();
  const s = document.createElement('script');
  s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error(`load ${src}`));
  document.head.append(s);
});

async function token(): Promise<string> {
  await script('https://accounts.google.com/gsi/client');
  return new Promise((res, rej) => {
    google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (r: any) => (r.access_token ? res(r.access_token) : rej(new Error(r.error ?? 'no token'))),
    }).requestAccessToken();
  });
}

async function pickId(tok: string): Promise<string | undefined> {
  await script('https://apis.google.com/js/api.js');
  await new Promise<void>((r) => gapi.load('picker', r));
  return new Promise((res) => {
    const view = new google.picker.DocsView().setIncludeFolders(true).setQuery('apkg OR colpkg');
    new google.picker.PickerBuilder()
      .setOAuthToken(tok).setDeveloperKey(API_KEY ?? '').addView(view)
      .setCallback((d: any) => {
        if (d.action === google.picker.Action.PICKED) res(d.docs[0].id);
        else if (d.action === google.picker.Action.CANCEL) res(undefined);
      })
      .build().setVisible(true);
  });
}

export async function pickGDriveFile(onProgress?: (loaded: number, total: number) => void): Promise<Uint8Array | undefined> {
  const tok = await token();
  const id = await pickId(tok);
  if (!id) return;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`drive ${r.status}`);
  const total = Number(r.headers.get('content-length') ?? 0);
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = r.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.length; onProgress?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
