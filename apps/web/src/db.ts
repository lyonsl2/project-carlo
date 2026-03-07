import initSqlJs, { type Database } from "sql.js";

let dbPromise: Promise<Database> | null = null;

function init(): Promise<Database> {
  return Promise.all([
    initSqlJs({ locateFile: (file: string) => `/${file}` }),
    fetch("/frontend.db").then((r) => {
      if (!r.ok) throw new Error(`Failed to fetch frontend.db: ${r.status}`);
      return r.arrayBuffer();
    }),
  ]).then(([SQL, buf]) => new SQL.Database(new Uint8Array(buf)));
}

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = init();
  }
  return dbPromise;
}
