import type { SQLiteDatabaseInterface, SQLiteDatabaseOptions } from './types.js'
import { SQLiteDatabase } from './SQLiteDatabase.js'

/**
 * Creates a synchronous SQLite database over `node:sqlite`.
 *
 * @remarks
 * The wrapper connects lazily — call `connect` (or it is required by the first
 * operation, which throws `CLOSED` until then). This is the standalone,
 * server-native SQLite handle; `@orkestrel/database`'s SQLite driver builds on it.
 *
 * @param options - The database options; see {@link SQLiteDatabaseOptions} for `path`, `readonly`, `timeout`, `foreignKeys`, and `bigints`. Default: an in-memory database (`path` `':memory:'`).
 * @returns A typed {@link SQLiteDatabaseInterface}
 *
 * @example
 * ```ts
 * import { createSQLiteDatabase } from '@orkestrel/sqlite'
 *
 * const db = createSQLiteDatabase({ path: ':memory:' })
 * db.connect()
 * db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)')
 * db.prepare('INSERT INTO users VALUES (?, ?)').execute(['u1', 'Ada'])
 * db.prepare('SELECT name FROM users WHERE id = ?').get(['u1']) // { name: 'Ada' }
 * ```
 */
export function createSQLiteDatabase(options?: SQLiteDatabaseOptions): SQLiteDatabaseInterface {
	return new SQLiteDatabase(options ?? {})
}
