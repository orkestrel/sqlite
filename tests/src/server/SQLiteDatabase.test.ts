import { createSQLiteDatabase, isSQLiteError, SQLiteError } from '@src/server'
import { isString } from '@orkestrel/contract'
import { captureError } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import {
	lockDatabase,
	REFUSED_PRAGMA_NAMES,
	REFUSED_PRAGMA_VALUES,
	sqliteErrorCode,
} from '../../setupServer.js'

// The SQLite wrapper in a real in-memory database, with no mocks — connect /
// connected / close lifecycle, the CLOSED gate before connect and after close,
// execute DDL, prepare round-trip, transact commit and rollback-on-throw, and
// pragma get + set with the INVALID refusal of a malformed name or value.

describe('SQLiteDatabase — lifecycle', () => {
	it('connects lazily and idempotently, and reports connected', () => {
		const db = createSQLiteDatabase()
		expect(db.path).toBe(':memory:')
		expect(db.connected).toBe(false)
		db.connect()
		expect(db.connected).toBe(true)
		db.connect() // idempotent — no throw, still one connection
		expect(db.connected).toBe(true)
		db.close()
		expect(db.connected).toBe(false)
	})

	it('honors an explicit path option', () => {
		const db = createSQLiteDatabase({ path: ':memory:' })
		expect(db.path).toBe(':memory:')
	})

	it('throws CLOSED when used before connect', () => {
		const db = createSQLiteDatabase()
		expect(() => db.execute('SELECT 1')).toThrow(SQLiteError)
		expect(sqliteErrorCode(() => db.execute('SELECT 1'))).toBe('CLOSED')
		expect(sqliteErrorCode(() => db.prepare('SELECT 1'))).toBe('CLOSED')
	})

	it('throws CLOSED after close', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE t (id INTEGER)')
		db.close()
		expect(sqliteErrorCode(() => db.execute('SELECT 1'))).toBe('CLOSED')
	})
})

describe('SQLiteDatabase — transacting', () => {
	it('is false when disconnected', () => {
		const db = createSQLiteDatabase()
		expect(db.transacting).toBe(false)
	})

	it('is false when idle-connected', () => {
		const db = createSQLiteDatabase()
		db.connect()
		expect(db.transacting).toBe(false)
		db.close()
	})

	it('is true inside a transaction scope', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
		db.transact(() => {
			expect(db.transacting).toBe(true)
		})
		expect(db.transacting).toBe(false)
		db.close()
	})

	it('is true between a manual BEGIN and COMMIT, and false after commit and rollback', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')

		db.execute('BEGIN')
		expect(db.transacting).toBe(true)
		db.execute('COMMIT')
		expect(db.transacting).toBe(false)

		db.execute('BEGIN')
		expect(db.transacting).toBe(true)
		db.execute('ROLLBACK')
		expect(db.transacting).toBe(false)

		db.close()
	})
})

describe('SQLiteDatabase — execute and prepare', () => {
	it('executes DDL and round-trips a row through a prepared statement', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
		db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u1', 'Ada', 36])
		expect(db.prepare('SELECT * FROM users WHERE id = ?').get(['u1'])).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
		})
	})

	it('wraps a malformed-SQL fault as a SQLiteError', () => {
		const db = createSQLiteDatabase()
		db.connect()
		expect(() => db.execute('NOT VALID SQL')).toThrow(SQLiteError)
	})
})

describe('SQLiteDatabase — transact', () => {
	it('commits the scope and returns its value', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
		const result = db.transact(() => {
			db.prepare('INSERT INTO t VALUES (?)').execute([1])
			db.prepare('INSERT INTO t VALUES (?)').execute([2])
			return 'done'
		})
		expect(result).toBe('done')
		expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 2 })
	})

	it('rolls back the scope on a throw and rethrows', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
		db.prepare('INSERT INTO t VALUES (?)').execute([1])
		expect(() =>
			db.transact(() => {
				db.prepare('INSERT INTO t VALUES (?)').execute([2])
				throw new Error('boom')
			}),
		).toThrow('boom')
		// The insert of 2 was rolled back; only the pre-transaction row 1 remains.
		expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 1 })
	})

	it('rolls back and throws INVALID when the scope returns a thenable (an async scope)', async () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
		expect(() =>
			db.transact(async () => {
				db.prepare('INSERT INTO t VALUES (?)').execute([1])
				await Promise.resolve()
			}),
		).toThrow(SQLiteError)
		expect(
			sqliteErrorCode(() =>
				db.transact(async () => {
					await Promise.resolve()
				}),
			),
		).toBe('INVALID')
		expect(db.transacting).toBe(false)
		expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 0 })
		db.close()
	})

	it('rethrows the original scope error, not a ROLLBACK fault, when the rollback itself fails', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
		const sentinel = new Error('sentinel scope error')
		expect(() =>
			db.transact(() => {
				db.close() // ROLLBACK will fault: the connection is closed
				throw sentinel
			}),
		).toThrow(sentinel)
	})
})

describe('SQLiteDatabase — begin / commit / rollback', () => {
	it('persists writes made between begin and commit', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
		db.begin()
		expect(db.transacting).toBe(true)
		db.prepare('INSERT INTO t VALUES (?)').execute([1])
		db.commit()
		expect(db.transacting).toBe(false)
		expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 1 })
	})

	it('discards writes made between begin and rollback', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
		db.begin()
		db.prepare('INSERT INTO t VALUES (?)').execute([1])
		expect(db.transacting).toBe(true)
		db.rollback()
		expect(db.transacting).toBe(false)
		expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 0 })
	})

	it('throws the native fault as a SQLiteError on a nested begin', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.begin()
		expect(() => db.begin()).toThrow(SQLiteError)
		db.rollback()
	})

	it('throws the native fault as a SQLiteError committing without an open transaction', () => {
		const db = createSQLiteDatabase()
		db.connect()
		expect(() => db.commit()).toThrow(SQLiteError)
	})

	it('throws the native fault as a SQLiteError rolling back without an open transaction', () => {
		const db = createSQLiteDatabase()
		db.connect()
		expect(() => db.rollback()).toThrow(SQLiteError)
	})
})

describe('SQLiteDatabase — bigints', () => {
	it('throws on read for an out-of-range integer without bigints enabled', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
		db.prepare('INSERT INTO t VALUES (?, ?)').execute([1, 9007199254740993n])
		expect(sqliteErrorCode(() => db.prepare('SELECT value FROM t WHERE id = ?').get([1]))).toBe(
			'UNKNOWN',
		)
		db.close()
	})

	it('round-trips an out-of-range integer exactly when bigints is enabled', () => {
		const db = createSQLiteDatabase({ bigints: true })
		db.connect()
		db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
		db.prepare('INSERT INTO t VALUES (?, ?)').execute([1, 9007199254740993n])
		expect(db.prepare('SELECT value FROM t WHERE id = ?').get([1])).toEqual({
			value: 9007199254740993n,
		})
		db.close()
	})

	it('returns every integer column as bigint when bigints is enabled, not only out-of-range ones', () => {
		const db = createSQLiteDatabase({ bigints: true })
		db.connect()
		db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
		db.prepare('INSERT INTO t VALUES (?, ?)').execute([1, 5])
		expect(db.prepare('SELECT value FROM t WHERE id = ?').get([1])).toEqual({ value: 5n })
		db.close()
	})
})

describe('SQLiteDatabase — pragma', () => {
	const scratch = createScratch({ prefix: 'sqlite-pragma-test-' })
	afterAll(() => scratch.destroy())

	it('reads a pragma value', () => {
		const db = createSQLiteDatabase()
		db.connect()
		expect(db.pragma('user_version')).toBe(0)
	})

	it('sets then reads a pragma value', () => {
		const db = createSQLiteDatabase()
		db.connect()
		expect(db.pragma('user_version', 7)).toBe(7)
		expect(db.pragma('user_version')).toBe(7)
	})

	it('sets then reads a negative number', () => {
		const db = createSQLiteDatabase()
		db.connect()
		expect(db.pragma('cache_size', -2000)).toBe(-2000)
		expect(db.pragma('cache_size')).toBe(-2000)
	})

	it('sets then reads a keyword on a file database', () => {
		const db = createSQLiteDatabase({ path: join(scratch.path, 'keyword.db') })
		db.connect()
		expect(db.pragma('journal_mode')).toBe('delete')
		expect(db.pragma('journal_mode', 'WAL')).toBe('wal')
		db.close()
	})

	it('reads undefined for a name the guard admits and the engine does not know', () => {
		const db = createSQLiteDatabase()
		db.connect()
		expect(db.pragma('_hidden')).toBeUndefined()
	})
})

describe('SQLiteDatabase — pragma refusal', () => {
	it.for(REFUSED_PRAGMA_NAMES)(
		'refuses $label as a name with INVALID before any SQL runs',
		({ input }) => {
			const db = createSQLiteDatabase()
			db.connect()
			expect.soft(sqliteErrorCode(() => db.pragma(input))).toBe('INVALID')
			expect.soft(sqliteErrorCode(() => db.pragma(input, 7))).toBe('INVALID')
			expect.soft(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 })
			expect.soft(db.prepare('SELECT name FROM sqlite_master').all()).toEqual([])
			db.close()
			expect.soft(sqliteErrorCode(() => db.pragma(input))).toBe('INVALID')
		},
	)

	it.for(REFUSED_PRAGMA_VALUES)(
		'refuses $label as a value with INVALID before any SQL runs',
		({ input }) => {
			const db = createSQLiteDatabase()
			db.connect()
			expect.soft(sqliteErrorCode(() => db.pragma('journal_mode', input))).toBe('INVALID')
			expect.soft(db.prepare('SELECT name FROM sqlite_master').all()).toEqual([])
			db.close()
			expect.soft(sqliteErrorCode(() => db.pragma('journal_mode', input))).toBe('INVALID')
		},
	)

	it('refuses what the engine misreads: an exponent-form integer pragma sets its leading digit', () => {
		const native = new DatabaseSync(':memory:')
		native.exec('PRAGMA cache_size = 1e+21')
		expect(native.prepare('PRAGMA cache_size').get()).toEqual({ cache_size: 1 })
		native.close()
		const db = createSQLiteDatabase()
		db.connect()
		expect(sqliteErrorCode(() => db.pragma('cache_size', 1e21))).toBe('INVALID')
		expect(db.pragma('cache_size')).toBe(-2000)
		db.close()
	})

	it('refuses what the engine misreads: an integer pragma past 32 bits sets 0', () => {
		const native = new DatabaseSync(':memory:')
		native.exec('PRAGMA user_version = 2147483647')
		expect(native.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2147483647 })
		native.exec('PRAGMA user_version = 2147483648')
		expect(native.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 })
		native.close()
		const db = createSQLiteDatabase()
		db.connect()
		expect(db.pragma('user_version', 2147483647)).toBe(2147483647)
		expect(sqliteErrorCode(() => db.pragma('user_version', 2147483648))).toBe('INVALID')
		expect(db.pragma('user_version')).toBe(2147483647)
		db.close()
	})

	it('carries each refused input encoded and capped in its context', () => {
		const db = createSQLiteDatabase()
		const name = captureError(() => db.pragma('main.user_version'))
		expect(isSQLiteError(name) ? name.context : undefined).toEqual({
			pragma: '"main.user_version"',
		})
		const value = captureError(() => db.pragma('journal_mode', 'WAL\n'))
		expect(isSQLiteError(value) ? value.context : undefined).toEqual({
			pragma: '"journal_mode"',
			value: '"WAL\\n"',
		})
		const short = captureError(() => db.pragma(`${'user_version'.repeat(100)};`))
		const long = captureError(() => db.pragma(`${'user_version'.repeat(1000)};`))
		const clipped = isSQLiteError(short) ? short.context?.['pragma'] : undefined
		const capped = isSQLiteError(long) ? long.context?.['pragma'] : undefined
		expect(isString(capped) && capped.endsWith('…')).toBe(true)
		expect(isString(capped) ? capped.length : undefined).toBe(
			isString(clipped) ? clipped.length : 0,
		)
		expect(isSQLiteError(long) ? long.message.length : undefined).toBe(
			isSQLiteError(short) ? short.message.length : 0,
		)
		const fraction = captureError(() => db.pragma('cache_size', 1.5))
		expect(isSQLiteError(fraction) ? fraction.context : undefined).toEqual({
			pragma: '"cache_size"',
			value: '1.5',
		})
		const array = captureError(() => Reflect.apply(db.pragma, db, ['cache_size', ['WAL']]))
		expect(isSQLiteError(array) ? array.context : undefined).toEqual({
			pragma: '"cache_size"',
			value: 'array',
		})
		const object = captureError(() => Reflect.apply(db.pragma, db, [{ name: 'user_version' }]))
		expect(isSQLiteError(object) ? object.context : undefined).toEqual({ pragma: 'object' })
		const shortValue = captureError(() => db.pragma('journal_mode', `${'WAL'.repeat(100)};`))
		const longValue = captureError(() => db.pragma('journal_mode', `${'WAL'.repeat(1000)};`))
		const clippedValue = isSQLiteError(shortValue) ? shortValue.context?.['value'] : undefined
		const cappedValue = isSQLiteError(longValue) ? longValue.context?.['value'] : undefined
		expect(isString(cappedValue) && cappedValue.endsWith('…')).toBe(true)
		expect(isString(cappedValue) ? cappedValue.length : undefined).toBe(
			isString(clippedValue) ? clippedValue.length : 0,
		)
		expect(isSQLiteError(longValue) ? longValue.message.length : undefined).toBe(
			isSQLiteError(shortValue) ? shortValue.message.length : 0,
		)
	})
})

describe('SQLiteDatabase — production options', () => {
	const scratch = createScratch({ prefix: 'sqlite-database-test-' })
	afterAll(() => scratch.destroy())

	it('opens read-only and rejects a write', () => {
		const path = join(scratch.path, 'readonly.db')
		const seed = createSQLiteDatabase({ path })
		seed.connect()
		seed.execute('CREATE TABLE t (id INTEGER)')
		seed.close()

		const db = createSQLiteDatabase({ path, readonly: true })
		db.connect()
		expect(sqliteErrorCode(() => db.execute('INSERT INTO t VALUES (1)'))).toBe('UNKNOWN')
		db.close()
	})

	it('enforces foreign key constraints when enabled', () => {
		const db = createSQLiteDatabase({ foreignKeys: true })
		db.connect()
		db.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY)')
		db.execute(
			'CREATE TABLE child (id INTEGER PRIMARY KEY, parentId INTEGER REFERENCES parent(id))',
		)
		expect(sqliteErrorCode(() => db.execute('INSERT INTO child VALUES (1, 999)'))).toBe(
			'CONSTRAINT',
		)
		db.close()
	})

	it('threads a busy timeout and surfaces BUSY from a locked second connection', () => {
		const path = join(scratch.path, 'busy.db')
		const holder = lockDatabase(path)

		const contender = createSQLiteDatabase({ path, timeout: 50 })
		contender.connect()
		expect(sqliteErrorCode(() => contender.execute('INSERT INTO t VALUES (2)'))).toBe('BUSY')
		contender.close()

		holder.exec('ROLLBACK')
		holder.close()
	})

	it('closes the connection through Symbol.dispose in a using block', () => {
		const db = createSQLiteDatabase()
		{
			using scoped = db
			scoped.connect()
			expect(scoped.connected).toBe(true)
		}
		expect(db?.connected).toBe(false)
	})
})
