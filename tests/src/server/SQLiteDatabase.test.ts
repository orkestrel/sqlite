import { createSQLiteDatabase, SQLiteError } from '@src/server'
import { createScratch } from '@orkestrel/test/server'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { lockDatabase, sqliteErrorCode } from '../../setupServer.js'

// The SQLite wrapper in a real in-memory database, with no mocks — connect /
// connected / close lifecycle, the CLOSED gate before connect and after close,
// execute DDL, prepare round-trip, transact commit and rollback-on-throw, and
// pragma get + set.

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
		let db: ReturnType<typeof createSQLiteDatabase> | undefined
		{
			using scoped = createSQLiteDatabase()
			scoped.connect()
			db = scoped
			expect(scoped.connected).toBe(true)
		}
		expect(db?.connected).toBe(false)
	})
})
