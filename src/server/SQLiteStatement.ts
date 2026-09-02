import type { StatementSync } from 'node:sqlite'
import type {
	SQLiteParameters,
	SQLiteRow,
	SQLiteRunResult,
	SQLiteStatementInterface,
} from './types.js'
import { SQLiteError } from './errors.js'
import { bindParameters, wrapError } from './helpers.js'

/**
 * Represents a prepared statement over `node:sqlite`'s `StatementSync` — the only way the
 * wrapper runs SQL.
 *
 * @remarks
 * Created by `database.prepare(sql)`, which threads a liveness check (internal —
 * this constructor's second parameter is not part of the documented surface).
 * Bare named parameters are enabled on construction so a record's keys bind
 * without the SQL prefix character. Each method first gates on that liveness
 * check, throwing a `CLOSED` `SQLiteError` once the owning connection has been
 * closed — a statement prepared on a connection that is later closed and then
 * reconnected stays `CLOSED`; a fresh statement must be prepared on the new
 * connection. Each method then binds the optional parameters (an array spread
 * to `?` placeholders, a record passed as a single named object) and executes
 * synchronously, mapping any native fault to a `SQLiteError` — including a
 * mid-stream fault from `iterate`'s lazy native iterator, stepped inside its own
 * try/catch so a fault on a later row is mapped exactly like an eager one. Row
 * values arrive as the native {@link SQLiteRow} types; the typed layer above
 * (the driver) imposes a precise shape through a contract rather than
 * re-narrowing here (AGENTS §14).
 */
export class SQLiteStatement implements SQLiteStatementInterface {
	readonly #statement: StatementSync
	readonly #closed: () => boolean

	constructor(statement: StatementSync, closed: () => boolean) {
		this.#statement = statement
		this.#closed = closed
		this.#statement.setAllowBareNamedParameters(true)
	}

	run(parameters?: SQLiteParameters): SQLiteRunResult {
		this.#require()
		try {
			const bound = bindParameters(parameters)
			const result =
				'named' in bound
					? this.#statement.run(bound.named)
					: this.#statement.run(...bound.positional)
			return { changes: Number(result.changes), rowid: Number(result.lastInsertRowid) }
		} catch (error) {
			throw wrapError(error)
		}
	}

	get(parameters?: SQLiteParameters): SQLiteRow | undefined {
		this.#require()
		try {
			const bound = bindParameters(parameters)
			return 'named' in bound
				? this.#statement.get(bound.named)
				: this.#statement.get(...bound.positional)
		} catch (error) {
			throw wrapError(error)
		}
	}

	all(parameters?: SQLiteParameters): readonly SQLiteRow[] {
		this.#require()
		try {
			const bound = bindParameters(parameters)
			return 'named' in bound
				? this.#statement.all(bound.named)
				: this.#statement.all(...bound.positional)
		} catch (error) {
			throw wrapError(error)
		}
	}

	iterate(parameters?: SQLiteParameters): IterableIterator<SQLiteRow> {
		this.#require()
		let native: IterableIterator<SQLiteRow>
		try {
			const bound = bindParameters(parameters)
			native =
				'named' in bound
					? this.#statement.iterate(bound.named)
					: this.#statement.iterate(...bound.positional)
		} catch (error) {
			throw wrapError(error)
		}
		return this.#stream(native)
	}

	// The single liveness gate — every operation requires the owning connection
	// to still be open (mirrors SQLiteDatabase#require).
	#require(): void {
		if (this.#closed()) {
			throw new SQLiteError(
				'CLOSED',
				'Statement is closed — its connection was closed; prepare a new statement',
			)
		}
	}

	// Pulls from the native lazy iterator one step at a time, each step inside
	// its own try/catch — a mid-stream native fault (e.g. an out-of-range
	// integer on a later row) is mapped to a SQLiteError exactly like an eager
	// fault, instead of escaping raw from the caller's for...of.
	*#stream(native: IterableIterator<SQLiteRow>): IterableIterator<SQLiteRow> {
		for (;;) {
			let result: IteratorResult<SQLiteRow>
			try {
				result = native.next()
			} catch (error) {
				throw wrapError(error)
			}
			if (result.done === true) return
			yield result.value
		}
	}
}
