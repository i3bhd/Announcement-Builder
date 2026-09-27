import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../runtime/storage.mjs';

export function migrate() {
  const db = openDatabase();
  const directory = fileURLToPath(new URL('../drizzle/', import.meta.url));
  db.exec('CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL, applied_at TEXT NOT NULL)');
  for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${directory}/${name}`, 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT hash FROM app_migrations WHERE name = ?').get(name);
      if (previous && previous.hash !== hash) throw new Error(`Applied migration changed: ${name}`);
      if (!previous) {
        db.exec(sql);
        db.prepare('INSERT INTO app_migrations VALUES (?, ?, ?)').run(name, hash, new Date().toISOString());
        console.log(`Applied migration: ${name}`);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) migrate();
