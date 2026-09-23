// Local file picker. On iOS this opens Files, which lists iCloud Drive and any other installed
// storage provider (Google Drive, Dropbox) under Browse > Locations.
//
// iOS deliberately has no `accept` filter: Safari maps accept entries to UTIs, and `.apkg`/`.colpkg`
// are not registered types, so every file greys out and nothing can be picked. Desktop keeps the
// filter. The input is attached to the document because detached inputs do not always open on iOS.
export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const acceptAttr = () => (isIOS() ? '' : '.apkg,.colpkg,application/zip,application/octet-stream');

export function pickLocalFile(): Promise<File | undefined> {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    const accept = acceptAttr();
    if (accept) i.accept = accept;
    i.style.position = 'fixed';
    i.style.opacity = '0';
    i.style.pointerEvents = 'none';
    document.body.append(i);
    const done = (f?: File) => { i.remove(); res(f); };
    i.onchange = () => done(i.files?.[0] ?? undefined);
    i.oncancel = () => done(undefined);
    i.click();
  });
}

export const looksLikePackage = (name: string) => /\.(apkg|colpkg|zip)$/i.test(name);
