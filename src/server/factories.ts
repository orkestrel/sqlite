import type { SQLiteDatabaseInterface, SQLiteDatabaseOptions } from './types.js'
import { SQLiteDatabase } from './SQLiteDatabase.js'

/**
 * Create a synchronous SQLite database over `node:sqlite`.
 *
 * @remarks
 * The wrapper connects lazily — call `connect` (or it is required by the first
 * operation, which throws `CLOSED` until then). This is the lower-level native
 * handle a higher-level typed database engine would be built on; here it ships
 * as the standalone, server-native SQLite surface.
 *
 * @param options - The database `path` (a file path, or `':memory:'` by default)
 * @returns A typed {@link SQLiteDatabaseInterface}
 *
 * @example
 * ```ts
 * import { createSQLiteDatabase } from '@orkestrel/sqlite'
 *
 * const db = createSQLiteDatabase({ path: ':memory:' })
 * db.connect()
 * db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)')
 * db.prepare('INSERT INTO users VALUES (?, ?)').run(['u1', 'Ada'])
 * db.prepare('SELECT name FROM users WHERE id = ?').get(['u1']) // { name: 'Ada' }
 * ```
 */
export function createSQLiteDatabase(options?: SQLiteDatabaseOptions): SQLiteDatabaseInterface {
	return new SQLiteDatabase(options ?? {})
}
