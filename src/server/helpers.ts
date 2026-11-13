import type { SQLiteBinding, SQLiteParameterSet, SQLiteValue } from './types.js'
import {
	attempt,
	errorToMessage,
	INTRINSICS,
	isArray,
	isDefined,
	isError,
	isNumber,
	isObject,
	isSuccess,
	isUndefined,
} from '@orkestrel/contract'
import { SQLITE_BUSY, SQLITE_CONSTRAINT } from './constants.js'
import { isSQLiteError, SQLiteError } from './errors.js'

// The wrapper's boundary helpers, shared by `SQLiteDatabase` and `SQLiteStatement`:
// `wrapError` maps a thrown native `node:sqlite` error to a typed `SQLiteError`
// (the one narrowing point — one contained `errcode` read, never `as`), and
// `bindParameters` normalizes a `SQLiteParameterSet` value to the shape a
// native `StatementSync` call expects (positional spread, or a single named
// record). Both are pure.

/**
 * Converts a thrown native `node:sqlite` error into a typed {@link SQLiteError} at the
 * wrapper's one boundary.
 *
 * @remarks
 * The thrown value arrives as `unknown`. Its `errcode` is read once inside `attempt` and
 * narrowed with `isNumber`, so a throwing getter reads as absent. `isObject` admits the read
 * rather than `isRecord`, because a native `node:sqlite` error is an `Error` instance whose
 * prototype fails the plain-record test. The low byte of `errcode` maps a constraint violation
 * (`SQLITE_CONSTRAINT`) to code `'CONSTRAINT'` and a locked-database fault (`SQLITE_BUSY`) to
 * `'BUSY'`; anything else is `'UNKNOWN'`. An `Error` keeps its message, read through
 * `errorToMessage`, which answers `'unknown failure'` for a message it cannot read; any other
 * value carries `'Unknown SQLite error'`. `{ errcode }` is carried in `context` when present. An
 * already-typed `SQLiteError` is returned unchanged.
 *
 * @param error - The thrown value to convert
 * @returns The equivalent `SQLiteError`
 *
 * @example
 * ```ts
 * import { wrapError } from '@orkestrel/sqlite'
 *
 * const native = Object.assign(new Error('UNIQUE constraint failed: users.id'), { errcode: 1555 })
 * wrapError(native).code // 'CONSTRAINT'
 * wrapError(native).context // { errcode: 1555 }
 * wrapError('not an error').code // 'UNKNOWN'
 * ```
 */
export function wrapError(error: unknown): SQLiteError {
	if (isSQLiteError(error)) return error
	const read = attempt((): unknown =>
		isObject(error) ? INTRINSICS.reflect.read(error, 'errcode') : undefined,
	)
	const errcode = isSuccess(read) && isNumber(read.value) ? read.value : undefined
	const message = isError(error) ? errorToMessage(error) : 'Unknown SQLite error'
	const code =
		isDefined(errcode) && (errcode & 0xff) === SQLITE_CONSTRAINT
			? 'CONSTRAINT'
			: isDefined(errcode) && (errcode & 0xff) === SQLITE_BUSY
				? 'BUSY'
				: 'UNKNOWN'
	return new SQLiteError(code, message, isDefined(errcode) ? { errcode } : undefined)
}

/**
 * Normalizes a {@link SQLiteParameterSet} value to the binding shape a native `StatementSync`
 * call expects — a positional spread, or a single named record.
 *
 * @remarks
 * Positional parameters (an array) bind to `?` placeholders and are spread into
 * the call; named parameters (a record) bind to bare `:name` placeholders and are
 * passed as a single leading object. Returning a discriminated result keeps the
 * `SQLiteStatement` dispatch typed against the native overloads without `as`.
 *
 * @param parameters - The wrapper parameters, or `undefined` for none
 * @returns The {@link SQLiteBinding} — `{ positional }` for an array (empty when omitted) or `{ named }` for a record
 *
 * @example
 * ```ts
 * import { bindParameters } from '@orkestrel/sqlite'
 *
 * bindParameters(['u1', 'Ada']) // { positional: ['u1', 'Ada'] }
 * bindParameters({ id: 'u1' }) // { named: { id: 'u1' } }
 * bindParameters() // { positional: [] }
 * ```
 */
export function bindParameters(parameters?: SQLiteParameterSet): SQLiteBinding {
	if (isUndefined(parameters)) return { positional: [] }
	if (isArray<SQLiteValue>(parameters)) return { positional: parameters }
	return { named: parameters }
}
