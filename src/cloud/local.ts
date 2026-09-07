// Local file picker. On iOS this opens Files, which includes iCloud Drive.
export function pickLocalFile(): Promise<File | undefined> {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = '.apkg,.colpkg,application/zip';
    i.onchange = () => res(i.files?.[0]);
    i.oncancel = () => res(undefined);
    i.click();
  });
}
