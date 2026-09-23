// Google Drive via GIS token client + Picker. Scope drive.file: only the files the user picks.
//
// iOS notes: the OAuth popup is blocked unless requestAccessToken() runs inside the click handler,
// so the scripts and the token client are prepared ahead of time by prepareGDrive(). The client id
// can also be set at runtime, because a static build has no way to carry a per-user secret.
const ENV_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const ENV_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const LS_CLIENT = 'gdrive.clientId', LS_KEY = 'gdrive.apiKey';

const ls = (k: string) => { try { return localStorage.getItem(k) ?? undefined; } catch { return undefined; } };
export const gdriveClientId = () => ls(LS_CLIENT) ?? ENV_CLIENT_ID;
export const gdriveApiKey = () => ls(LS_KEY) ?? ENV_API_KEY;
export const gdriveAvailable = () => !!gdriveClientId();
export function setGDriveConfig(clientId: string, apiKey: string) {
  try { localStorage.setItem(LS_CLIENT, clientId.trim()); localStorage.setItem(LS_KEY, apiKey.trim()); } catch { /* private mode */ }
}
// The project number is the leading digits of the client id; the Picker needs it for drive.file.
const appId = () => gdriveClientId()?.split('-')[0] ?? '';

declare const google: any;
declare const gapi: any;

const script = (src: string) => new Promise<void>((res, rej) => {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) { if (existing.dataset.loaded) res(); else { existing.addEventListener('load', () => res()); existing.addEventListener('error', () => rej(new Error(`load ${src}`))); } return; }
  const s = document.createElement('script');
  s.src = src; s.async = true;
  s.onload = () => { s.dataset.loaded = '1'; res(); };
  s.onerror = () => rej(new Error(`load ${src}`));
  document.head.append(s);
});

let tokenClient: any;
export async function prepareGDrive(): Promise<void> {
  if (!gdriveAvailable() || tokenClient) return;
  await script('https://accounts.google.com/gsi/client');
  await script('https://apis.google.com/js/api.js');
  await new Promise<void>((r) => gapi.load('picker', r));
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: gdriveClientId(), scope: 'https://www.googleapis.com/auth/drive.file', callback: () => {},
  });
}

const token = () => new Promise<string>((res, rej) => {
  if (!tokenClient) return rej(new Error('Google Drive is still loading, try again'));
  tokenClient.callback = (r: any) => (r.access_token ? res(r.access_token) : rej(new Error(r.error_description ?? r.error ?? 'sign-in cancelled')));
  tokenClient.requestAccessToken();
});

const pickId = (tok: string) => new Promise<string | undefined>((res) => {
  const view = new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
  const b = new google.picker.PickerBuilder()
    .setOAuthToken(tok).setAppId(appId()).addView(view)
    .setCallback((d: any) => {
      if (d.action === google.picker.Action.PICKED) res(d.docs[0].id);
      else if (d.action === google.picker.Action.CANCEL) res(undefined);
    });
  const key = gdriveApiKey();
  if (key) b.setDeveloperKey(key);
  b.build().setVisible(true);
});

export async function pickGDriveFile(onProgress?: (loaded: number, total: number) => void): Promise<Uint8Array | undefined> {
  const tok = await token();
  const id = await pickId(tok);
  if (!id) return;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Drive download failed (${r.status})`);
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
