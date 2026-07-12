import { createSQLiteDatabase, SQLiteError } from '@src/server'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { sqliteErrorCode } from '../../setupServer.js'

// The SQLite wrapper in a real in-memory database (no mocks, AGENTS §16) —
// connect / connected / close lifecycle, the CLOSED gate before connect and after
// close, exec DDL, prepare round-trip, transaction commit and rollback-on-throw,
// and pragma get + set.

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
		expect(() => db.exec('SELECT 1')).toThrow(SQLiteError)
		expect(sqliteErrorCode(() => db.exec('SELECT 1'))).toBe('CLOSED')
		expect(sqliteErrorCode(() => db.prepare('SELECT 1'))).toBe('CLOSED')
	})

	it('throws CLOSED after close', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.exec('CREATE TABLE t (id INTEGER)')
		db.close()
		expect(sqliteErrorCode(() => db.exec('SELECT 1'))).toBe('CLOSED')
	})
})

describe('SQLiteDatabase — exec and prepare', () => {
	it('execs DDL and round-trips a row through a prepared statement', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
		db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(['u1', 'Ada', 36])
		expect(db.prepare('SELECT * FROM users WHERE id = ?').get(['u1'])).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
		})
	})

	it('wraps a malformed-SQL fault as a SQLiteError', () => {
		const db = createSQLiteDatabase()
		db.connect()
		expect(() => db.exec('NOT VALID SQL')).toThrow(SQLiteError)
	})
})

describe('SQLiteDatabase — transaction', () => {
	it('commits the scope and returns its value', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
		const result = db.transaction(() => {
			db.prepare('INSERT INTO t VALUES (?)').run([1])
			db.prepare('INSERT INTO t VALUES (?)').run([2])
			return 'done'
		})
		expect(result).toBe('done')
		expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 2 })
	})

	it('rolls back the scope on a throw and rethrows', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
		db.prepare('INSERT INTO t VALUES (?)').run([1])
		expect(() =>
			db.transaction(() => {
				db.prepare('INSERT INTO t VALUES (?)').run([2])
				throw new Error('boom')
			}),
		).toThrow('boom')
		// The insert of 2 was rolled back; only the pre-transaction row 1 remains.
		expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 1 })
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
	const dir = mkdtempSync(join(tmpdir(), 'sqlite-database-test-'))
	afterAll(() => rmSync(dir, { recursive: true, force: true }))

	it('opens read-only and rejects a write', () => {
		const path = join(dir, 'readonly.db')
		const seed = createSQLiteDatabase({ path })
		seed.connect()
		seed.exec('CREATE TABLE t (id INTEGER)')
		seed.close()

		const db = createSQLiteDatabase({ path, readonly: true })
		db.connect()
		expect(sqliteErrorCode(() => db.exec('INSERT INTO t VALUES (1)'))).toBe('UNKNOWN')
		db.close()
	})

	it('enforces foreign key constraints when enabled', () => {
		const db = createSQLiteDatabase({ foreignKeys: true })
		db.connect()
		db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)')
		db.exec('CREATE TABLE child (id INTEGER PRIMARY KEY, parentId INTEGER REFERENCES parent(id))')
		expect(sqliteErrorCode(() => db.exec('INSERT INTO child VALUES (1, 999)'))).toBe('CONSTRAINT')
		db.close()
	})

	it('threads a busy timeout and surfaces BUSY from a locked second connection', () => {
		const path = join(dir, 'busy.db')
		const seed = createSQLiteDatabase({ path })
		seed.connect()
		seed.exec('CREATE TABLE t (id INTEGER)')
		seed.close()

		const holder = createSQLiteDatabase({ path })
		holder.connect()
		holder.exec('BEGIN IMMEDIATE')
		holder.exec('INSERT INTO t VALUES (1)')

		const contender = createSQLiteDatabase({ path, timeout: 50 })
		contender.connect()
		expect(sqliteErrorCode(() => contender.exec('INSERT INTO t VALUES (2)'))).toBe('BUSY')
		contender.close()

		holder.exec('ROLLBACK')
		holder.close()
	})

	it('closes the connection via Symbol.dispose in a using block', () => {
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
