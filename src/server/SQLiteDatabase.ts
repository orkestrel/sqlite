import { DatabaseSync } from 'node:sqlite'
import type {
	SQLiteDatabaseInterface,
	SQLiteDatabaseOptions,
	SQLiteStatementInterface,
	SQLiteValue,
} from './types.js'
import { SQLiteError } from './errors.js'
import { wrapError } from './helpers.js'
import { SQLiteStatement } from './SQLiteStatement.js'

/**
 * A synchronous SQLite database over `node:sqlite`'s `DatabaseSync`.
 *
 * @remarks
 * Created by `createSQLiteDatabase`. It connects lazily (`connect` opens the
 * underlying `DatabaseSync`, idempotent) and every operation routes through a
 * private gate that throws a `CLOSED` `SQLiteError` before `connect` or after
 * `close`. `exec` runs result-less SQL; `prepare` compiles a `SQLiteStatement`;
 * `transaction` wraps a scope in `BEGIN` / `COMMIT`, rolling back on a throw;
 * `pragma` reads (or sets then reads) one PRAGMA value. A native fault surfaces as
 * a `SQLiteError` mapped at the boundary.
 */
export class SQLiteDatabase implements SQLiteDatabaseInterface {
	readonly #path: string
	#database: DatabaseSync | undefined

	constructor(options: SQLiteDatabaseOptions) {
		this.#path = options.path ?? ':memory:'
	}

	get path(): string {
		return this.#path
	}

	get connected(): boolean {
		return this.#database !== undefined
	}

	connect(): void {
		if (this.#database === undefined) this.#database = new DatabaseSync(this.#path)
	}

	close(): void {
		this.#database?.close()
		this.#database = undefined
	}

	exec(sql: string): void {
		try {
			this.#require().exec(sql)
		} catch (error) {
			throw wrapError(error)
		}
	}

	prepare(sql: string): SQLiteStatementInterface {
		try {
			return new SQLiteStatement(this.#require().prepare(sql))
		} catch (error) {
			throw wrapError(error)
		}
	}

	transaction<R>(scope: () => R): R {
		this.exec('BEGIN')
		try {
			const result = scope()
			this.exec('COMMIT')
			return result
		} catch (error) {
			this.exec('ROLLBACK')
			throw error
		}
	}

	// Pragmas cannot use bind parameters, so the value is interpolated — safe for
	// the trusted internal names this layer is called with.
	pragma(name: string, value?: string | number): SQLiteValue | undefined {
		if (value !== undefined) this.exec('PRAGMA ' + name + ' = ' + value)
		const row = this.prepare('PRAGMA ' + name).get()
		return row ? Object.values(row)[0] : undefined
	}

	// The single connection gate — every operation requires an open database.
	#require(): DatabaseSync {
		if (this.#database === undefined) {
			throw new SQLiteError('CLOSED', 'Database is not connected — call connect() first')
		}
		return this.#database
	}
}
