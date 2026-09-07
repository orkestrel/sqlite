import type { SQLiteDatabaseInterface, SQLiteDatabaseOptions } from './types.js'
import { SQLiteDatabase } from './SQLiteDatabase.js'

/**
 * Creates a synchronous SQLite database over `node:sqlite`, defaulting its path to `:memory:`.
 *
 * @remarks
 * The wrapper connects lazily — call `connect` (or it is required by the first
 * operation, which throws `CLOSED` until then). This is the standalone,
 * server-native SQLite handle; `@orkestrel/database`'s SQLite driver builds on it.
 *
 * @param options - The database options; see {@link SQLiteDatabaseOptions} for `path`, `readonly`, `timeout`, `foreignKeys`, and `bigints`. Default: an in-memory database (`path` `':memory:'`).
 * @returns A typed {@link SQLiteDatabaseInterface}
 *
 * @example Connect, execute, and round-trip a row
 * ```ts
 * import { createSQLiteDatabase } from '@orkestrel/sqlite'
 *
 * const db = createSQLiteDatabase() // path defaults to ':memory:'
 * db.connect()
 * db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
 * const result = db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u1', 'Ada', 36])
 * result.changes // 1
 * db.prepare('SELECT * FROM users WHERE id = ?').get(['u1']) // { id: 'u1', name: 'Ada', age: 36 }
 * ```
 */
export function createSQLiteDatabase(options?: SQLiteDatabaseOptions): SQLiteDatabaseInterface {
	return new SQLiteDatabase(options ?? {})
}
