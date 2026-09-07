import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

let sql: Promise<SqlJsStatic> | undefined;
export const loadSql = (locateFile?: (f: string) => string) => (sql ??= initSqlJs(locateFile ? { locateFile } : {}));

export async function openDb(bytes: Uint8Array, locateFile?: (f: string) => string): Promise<Database> {
  return new (await loadSql(locateFile)).Database(bytes);
}

export function rows<T = Record<string, unknown>>(db: Database, q: string): T[] {
  const st = db.prepare(q);
  const out: T[] = [];
  while (st.step()) out.push(st.getAsObject() as T);
  st.free();
  return out;
}
