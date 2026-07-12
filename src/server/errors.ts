import type { SQLiteErrorCode } from './types.js'

// Errors for the SQLite wrapper. A single `SQLiteError` carries a
// machine-readable `code` mapped from the native `node:sqlite` fault at the
// boundary (`wrapError`), so a `catch` branches on `error.code` rather than
// parsing a message. Mirrors the IndexedDB wrapper's `IndexedDBError`; its three
// codes are deliberately lean — the wrapper sits right on the raw SQLite surface,
// where the constraint fault is the one worth naming, `CLOSED` is the
// wrapper-lifecycle fault, and everything else is `UNKNOWN` (AGENTS §12).

/**
 * An error thrown by the SQLite wrapper.
 *
 * @remarks
 * Carries a {@link SQLiteErrorCode} and an optional `context` record (e.g. the
 * native SQLite `errcode`). Construct it directly for the `CLOSED`
 * wrapper-lifecycle fault; the internal `wrapError` maps a native `node:sqlite`
 * error to the right code at the boundary. Narrow a caught value with
 * {@link isSQLiteError}.
 *
 * @example
 * ```ts
 * try {
 * 	statement.run({ id: 'u1' })
 * } catch (error) {
 * 	if (isSQLiteError(error) && error.code === 'CONSTRAINT') {
 * 		// a UNIQUE / PRIMARY KEY violation
 * 	}
 * }
 * ```
 */
export class SQLiteError extends Error {
	readonly code: SQLiteErrorCode
	readonly context?: Readonly<Record<string, unknown>>

	constructor(code: SQLiteErrorCode, message: string, context?: Readonly<Record<string, unknown>>) {
		super(message)
		this.name = 'SQLiteError'
		this.code = code
		this.context = context
	}
}

/**
 * Whether a value is a {@link SQLiteError}.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a `SQLiteError`
 */
export function isSQLiteError(value: unknown): value is SQLiteError {
	return value instanceof SQLiteError
}
