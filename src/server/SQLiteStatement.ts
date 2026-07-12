import type { StatementSync } from 'node:sqlite'
import type {
	SQLiteParameters,
	SQLiteRow,
	SQLiteRunResult,
	SQLiteStatementInterface,
} from './types.js'
import { bindParameters, wrapError } from './helpers.js'

/**
 * A prepared statement over `node:sqlite`'s `StatementSync` — the only way the
 * wrapper runs SQL.
 *
 * @remarks
 * Created by `database.prepare(sql)`. Bare named parameters are enabled on
 * construction so a record's keys bind without the SQL prefix character. Each
 * method binds the optional parameters (an array spread to `?` placeholders, a
 * record passed as a single named object) and executes synchronously, mapping any
 * native fault to a `SQLiteError`. Row values arrive as the native
 * {@link SQLiteRow} types; the typed layer above (the driver) imposes a precise
 * shape through a contract rather than re-narrowing here (AGENTS §14).
 */
export class SQLiteStatement implements SQLiteStatementInterface {
	readonly #statement: StatementSync

	constructor(statement: StatementSync) {
		this.#statement = statement
		this.#statement.setAllowBareNamedParameters(true)
	}

	run(parameters?: SQLiteParameters): SQLiteRunResult {
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
		try {
			const bound = bindParameters(parameters)
			return 'named' in bound
				? this.#statement.iterate(bound.named)
				: this.#statement.iterate(...bound.positional)
		} catch (error) {
			throw wrapError(error)
		}
	}
}
