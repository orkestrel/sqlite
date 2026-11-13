// Server-test setup — node-only helpers, loaded after `setup.ts` for the node
// `src:server` test project.

import type { SQLiteDatabaseInterface } from '@src/server'
import { DatabaseSync } from 'node:sqlite'
import { createSQLiteDatabase, isSQLiteError } from '@src/server'

/** Creates a connected in-memory database with an empty users table. */
export function createTestDatabase(): SQLiteDatabaseInterface {
	const db = createSQLiteDatabase()
	db.connect()
	db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
	return db
}

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

/** Pairs one pragma input with the label a case title names it by. */
export interface PragmaCase<T> {
	readonly label: string
	readonly input: T
}

/**
 * Lists pragma names outside the name syntax, each a form that carries more than one bare name
 * into `PRAGMA` text.
 */
export const REFUSED_PRAGMA_NAMES: ReadonlyArray<PragmaCase<string>> = Object.freeze([
	{ label: 'an empty name', input: '' },
	{ label: 'a chained statement', input: 'user_version; CREATE TABLE intruders (id INTEGER)' },
	{ label: 'an assignment inside the name', input: 'user_version = 9' },
	{ label: 'a schema-qualified name', input: 'main.user_version' },
	{ label: 'a function-argument form', input: 'table_info(users)' },
	{ label: 'a quoted name', input: '"user_version"' },
	{ label: 'a leading space', input: ' user_version' },
	{ label: 'a trailing space', input: 'user_version ' },
	{ label: 'a trailing newline', input: 'user_version\n' },
	{ label: 'a lone equals sign', input: 'user_version=9' },
	{ label: 'a lone semicolon', input: 'user_version;' },
	{ label: 'a lone hyphen', input: 'user_version-' },
	{ label: 'a NUL character', input: 'user_version\u0000' },
	{ label: 'a leading digit', input: '2user_version' },
	{ label: 'a non-ASCII letter', input: 'üser_version' },
])

/**
 * Lists pragma values outside the value syntax: neither a 32-bit signed integer nor a keyword of ASCII
 * letters and underscores.
 */
export const REFUSED_PRAGMA_VALUES: ReadonlyArray<PragmaCase<string | number>> = Object.freeze([
	{ label: 'a chained pragma', input: 'WAL; PRAGMA case_sensitive_like = ON' },
	{ label: 'a chained statement', input: '0; CREATE TABLE intruders (id INTEGER)' },
	{ label: 'a lone semicolon', input: 'WAL;' },
	{ label: 'a lone equals sign', input: 'a=b' },
	{ label: 'a comment opener', input: 'WAL/*' },
	{ label: 'a trailing space', input: 'WAL ' },
	{ label: 'a trailing newline', input: 'WAL\n' },
	{ label: 'a quoted literal', input: "'WAL'" },
	{ label: 'an empty string', input: '' },
	{ label: 'a numeric string', input: '7' },
	{ label: 'a keyword with a digit', input: 'WAL2' },
	{ label: 'NaN', input: Number.NaN },
	{ label: 'positive infinity', input: Number.POSITIVE_INFINITY },
	{ label: 'negative infinity', input: Number.NEGATIVE_INFINITY },
	{ label: 'an exponent-form number', input: 1e21 },
	{ label: 'a positive fraction', input: 1.5 },
	{ label: 'a negative fraction', input: -0.5 },
	{ label: 'the smallest positive number', input: Number.MIN_VALUE },
	{ label: 'the first unsafe integer', input: 2 ** 53 },
	{ label: 'the first unsafe negative integer', input: -(2 ** 53) },
	{ label: 'one past the largest 32-bit integer', input: 2147483648 },
	{ label: 'one past the smallest 32-bit integer', input: -2147483649 },
	{ label: 'a 40-bit integer', input: 2 ** 40 },
	{ label: 'the largest number', input: Number.MAX_VALUE },
])

/** Lists pragma names inside the name syntax, an underscore opening and a digit included. */
export const ADMITTED_PRAGMA_NAMES: readonly string[] = Object.freeze([
	'user_version',
	'journal_mode',
	'Journal_Mode',
	'_hidden',
	'a1',
	'Z',
])

/** Lists pragma values inside the value syntax: keywords and 32-bit signed integers, both ends included. */
export const ADMITTED_PRAGMA_VALUES: ReadonlyArray<string | number> = Object.freeze([
	'WAL',
	'memory',
	'snake_case',
	'_',
	0,
	-0,
	7,
	-2000,
	2147483647,
	-2147483648,
])

/** Lists inputs that are neither a string nor a number, each refused by both pragma guards. */
export const UNTYPED_PRAGMA_INPUTS: readonly unknown[] = Object.freeze([
	undefined,
	null,
	true,
	false,
	7n,
	Symbol('journal_mode'),
	{},
	[],
	['WAL'],
	Object('WAL'),
	Object(7),
	new Date(0),
])

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
