import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

export const dataDirectory = () => resolve(process.env.DATA_DIR || './data');
let connection;
export function openDatabase() {
  if (!connection) {
    const directory = dataDirectory();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    connection = new DatabaseSync(join(directory, 'tamam.sqlite'));
    connection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }
  return connection;
}
