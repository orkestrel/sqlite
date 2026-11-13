import type { SQLiteErrorCode } from './types.js'
import {
	holds,
	INTRINSICS,
	isFunction,
	isDefined,
	isInstance,
	isObject,
	isUndefined,
} from '@orkestrel/contract'
import { isSQLiteErrorCode } from './validators.js'

// Errors for the SQLite wrapper. A single `SQLiteError` carries a
// machine-readable `code` mapped from the native `node:sqlite` fault at the
// boundary (`wrapError`), so a `catch` branches on `error.code` rather than
// parsing a message. Mirrors the IndexedDB wrapper's `IndexedDBError`; its codes
// stay lean — the wrapper sits right on the raw SQLite surface, where
// `CONSTRAINT` and `BUSY` are the native faults worth naming, `CLOSED` is the
// wrapper-lifecycle fault, `INVALID` is the wrapper's own invalid-argument fault,
// and everything else is `UNKNOWN`.

/**
 * Represents an error thrown by the SQLite wrapper, carrying a machine-readable `code` —
 * `CLOSED`, `CONSTRAINT`, `BUSY`, `INVALID`, or `UNKNOWN`.
 *
 * @remarks
 * The `code` is a {@link SQLiteErrorCode}, beside an optional `context` record (for example
 * the native SQLite `errcode`). Construct it directly for the `CLOSED`
 * wrapper-lifecycle fault; the internal `wrapError` maps a native `node:sqlite`
 * error to the right code at the boundary. Narrow a caught value with
 * {@link isSQLiteError}.
 *
 * @example
 * ```ts
 * import { createSQLiteDatabase, isSQLiteError } from '@orkestrel/sqlite'
 *
 * const db = createSQLiteDatabase()
 * db.connect()
 * db.execute('CREATE TABLE users (id TEXT PRIMARY KEY)')
 * const insert = db.prepare('INSERT INTO users (id) VALUES (?)')
 * insert.execute(['u1'])
 * try {
 * 	insert.execute(['u1'])
 * } catch (error) {
 * 	isSQLiteError(error) && error.code // 'CONSTRAINT'
 * }
 * ```
 */
export class SQLiteError extends Error {
	readonly code: SQLiteErrorCode
	readonly context?: Readonly<Record<string, unknown>>

	constructor(code: SQLiteErrorCode, message: string, context?: Readonly<Record<string, unknown>>) {
		super(message)
		INTRINSICS.define(this, Symbol.for('@orkestrel/sqlite.SQLiteError'), { value: this })
		this.name = 'SQLiteError'
		this.code = code
		if (isDefined(context)) this.context = context
	}
}

/**
 * Checks whether a value is a {@link SQLiteError}.
 *
 * @remarks
 * Recognizes the own identity brand and declared members across package copies.
 * Accepts subclasses without requiring their name; rejects transparent proxies.
 *
 * @param value - The value to test
 * @returns True if `value` is a `SQLiteError`; false otherwise
 *
 * @example
 * ```ts
 * import { isSQLiteError, SQLiteError } from '@orkestrel/sqlite'
 *
 * isSQLiteError(new SQLiteError('CLOSED', 'Database is not connected')) // true
 * isSQLiteError(new Error('Database is not connected')) // false
 * ```
 */
export function isSQLiteError(value: unknown): value is SQLiteError {
	return holds(() => {
		const intrinsic = INTRINSICS.error
		if (!isInstance(value, intrinsic) || INTRINSICS.prototype(value) === intrinsic.prototype)
			return false
		if (INTRINSICS.describe(value, Symbol.for('@orkestrel/sqlite.SQLiteError'))?.value !== value)
			return false
		const code: unknown = INTRINSICS.reflect.read(value, 'code')
		const context: unknown = INTRINSICS.reflect.read(value, 'context')
		return (
			isSQLiteErrorCode(code) && (isUndefined(context) || isObject(context) || isFunction(context))
		)
	})
}
