import type { SQLInputValue } from 'node:sqlite';
import { openDatabase } from '../runtime/storage.mjs';

// Preserve prepared queries while using durable SQLite in the container.
class Statement {
  constructor(private sql: string, private values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T = Record<string, unknown>>() {
    return (openDatabase().prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>() {
    return { results: openDatabase().prepare(this.sql).all(...this.values) as T[] };
  }
  execute() {
    const result = openDatabase().prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
  async run() { return this.execute(); }
}
const adapter = {
  prepare: (sql: string) => new Statement(sql),
  async batch(statements: Statement[]) {
    const db = openDatabase();
    db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => statement.execute());
      db.exec('COMMIT');
      return results;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  },
};
export const database = () => adapter;
