// Server-test setup — node-only helpers, loaded after `setup.ts` for the node
// `src:server` test project.

import type { SQLiteDatabaseInterface } from '@src/server'
import { DatabaseSync } from 'node:sqlite'
import { isSQLiteError } from '@src/server'

// Run `action`, returning a thrown `SQLiteError`'s `code` (or a sentinel) — so an
// error code is asserted unconditionally, never inside a conditional `expect`.
// Shared by the SQLite wrapper tests that branch on a fault's code.
export function sqliteErrorCode(action: () => unknown): string {
	try {
		action()
		return 'NO_THROW'
	} catch (error) {
		return isSQLiteError(error) ? error.code : 'NOT_SQLITE_ERROR'
	}
}

/**
 * Seeds the deterministic users into an open `users` table.
 *
 * @remarks
 * Prerequisite: `database` is connected and carries
 * `users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)`. The rows are `u1`/`Ada`/`36`,
 * `u2`/`Lin`/`29`, and `u3`/`Max`/`41`, in that order, so a read test can assert an
 * exact ordered result.
 *
 * @param database - The connected database to seed
 */
export function seedUsers(database: SQLiteDatabaseInterface): void {
	const insert = database.prepare('INSERT INTO users VALUES (?, ?, ?)')
	insert.execute(['u1', 'Ada', 36])
	insert.execute(['u2', 'Lin', 29])
	insert.execute(['u3', 'Max', 41])
}

/**
 * Captures the raw native `node:sqlite` error a duplicate primary key throws.
 *
 * @remarks
 * Drives `node:sqlite` directly, on a private in-memory database, so the returned
 * value carries the genuine native shape (`errcode` set) that the wrapper's own
 * boundary mapping is measured against. Going through the wrapper would return an
 * already-mapped `SQLiteError` instead.
 *
 * @returns The thrown native error, or `undefined` when the duplicate insert succeeded
 */
export function captureNativeConstraintError(): unknown {
	const database = new DatabaseSync(':memory:')
	database.exec('CREATE TABLE t (id TEXT PRIMARY KEY)')
	database.prepare('INSERT INTO t VALUES (?)').run('dup')
	try {
		database.prepare('INSERT INTO t VALUES (?)').run('dup')
		return undefined
	} catch (error) {
		return error
	} finally {
		database.close()
	}
}

/**
 * Locks a database file by holding an uncommitted `BEGIN IMMEDIATE` transaction on it.
 *
 * @remarks
 * Opens a native connection on `path`, creates the table `t (id INTEGER)` when the
 * file does not already carry it, opens an immediate transaction, and writes one row —
 * so a second connection to the same file meets a real write lock. The caller owns the
 * returned handle and releases the lock with `exec('ROLLBACK')` followed by `close()`.
 *
 * @param path - The database file path to lock
 * @returns The native holder connection, with its transaction still open
 */
export function lockDatabase(path: string): DatabaseSync {
	const holder = new DatabaseSync(path)
	holder.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER)')
	holder.exec('BEGIN IMMEDIATE')
	holder.prepare('INSERT INTO t VALUES (?)').run(1)
	return holder
}

/**
 * Captures the raw native `node:sqlite` error a write to a locked database throws.
 *
 * @remarks
 * Holds the lock with {@link lockDatabase} and writes from a second native connection
 * whose busy timeout is 50 ms, so the lock fault surfaces promptly and carries the
 * genuine native `errcode` the wrapper's boundary mapping is measured against. Both
 * connections are released before the error is returned.
 *
 * @param path - The database file path to contend for
 * @returns The thrown native error, or `undefined` when the contending write succeeded
 */
export function captureNativeBusyError(path: string): unknown {
	const holder = lockDatabase(path)
	const contender = new DatabaseSync(path, { timeout: 50 })
	try {
		contender.prepare('INSERT INTO t VALUES (?)').run(2)
		return undefined
	} catch (error) {
		return error
	} finally {
		contender.close()
		holder.exec('ROLLBACK')
		holder.close()
	}
}
