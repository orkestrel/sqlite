import type { SQLiteParameters, SQLiteValue } from './types.js'
import { isArray, isObject } from '@src/core'
import { SQLITE_CONSTRAINT } from './constants.js'
import { SQLiteError } from './errors.js'

// The wrapper's boundary helpers, shared by `SQLiteDatabase` and `SQLiteStatement`:
// `wrapError` maps a thrown native `node:sqlite` error to a typed `SQLiteError`
// (the one honest narrowing point — `isObject` + `in`, never `as`, per AGENTS
// §14), and `bindParameters` normalizes the wrapper's `SQLiteParameters` to the
// shape a native `StatementSync` call expects (positional spread vs. a single
// named record). Both are pure.

/**
 * Convert a thrown native `node:sqlite` error into a typed {@link SQLiteError}.
 *
 * @remarks
 * The single boundary mapping for the wrapper. The thrown value arrives as
 * `unknown` and is narrowed with `isObject` + the `in` operator (never `as`, and
 * not `isRecord` — a native `node:sqlite` error is an `Error` instance, so its
 * prototype fails the plain-record test) to read its `errcode` — a numeric SQLite
 * result code whose low byte identifies a constraint violation
 * (`SQLITE_CONSTRAINT`), mapped to code `'CONSTRAINT'`; anything else is
 * `'UNKNOWN'`. The original message is preserved and `{ errcode }` carried in
 * `context` when present. An already-typed `SQLiteError` is returned unchanged.
 *
 * @param error - The thrown value to convert
 * @returns The equivalent `SQLiteError`
 */
export function wrapError(error: unknown): SQLiteError {
	if (error instanceof SQLiteError) return error
	const errcode =
		isObject(error) && 'errcode' in error && typeof error.errcode === 'number'
			? error.errcode
			: undefined
	const message = error instanceof Error ? error.message : 'Unknown SQLite error'
	const code =
		errcode !== undefined && (errcode & 0xff) === SQLITE_CONSTRAINT ? 'CONSTRAINT' : 'UNKNOWN'
	return new SQLiteError(code, message, errcode !== undefined ? { errcode } : undefined)
}

/**
 * Normalize {@link SQLiteParameters} to the binding shape a native `StatementSync`
 * call expects.
 *
 * @remarks
 * Positional parameters (an array) bind to `?` placeholders and are spread into
 * the call; named parameters (a record) bind to bare `:name` placeholders and are
 * passed as a single leading object. Returning a discriminated result keeps the
 * `SQLiteStatement` dispatch typed against the native overloads without `as`.
 *
 * @param parameters - The wrapper parameters, or `undefined` for none
 * @returns `{ positional }` for an array (empty when omitted) or `{ named }` for a record
 */
export function bindParameters(
	parameters?: SQLiteParameters,
):
	| { readonly positional: readonly SQLiteValue[] }
	| { readonly named: Readonly<Record<string, SQLiteValue>> } {
	if (parameters === undefined) return { positional: [] }
	if (isArray<SQLiteValue>(parameters)) return { positional: parameters }
	return { named: parameters }
}
