import type { SQLiteDatabaseInterface, SQLiteRow } from '@src/server'
import { createSQLiteDatabase } from '@src/server'
import { createScratch } from '@orkestrel/test/server'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { seedUsers, sqliteErrorCode } from '../../setupServer.js'

// SQLiteStatement over a real in-memory database, with no mocks — execute's
// result shape, positional (`?`) and named (a record) parameter binding, get /
// all / iterate, an abandoned stream releasing its read lock and finalizing
// without throwing, and a constraint violation surfacing as a CONSTRAINT
// SQLiteError. A fresh seeded database per test keeps each deterministic.

let db: SQLiteDatabaseInterface

beforeEach(() => {
	db = createSQLiteDatabase()
	db.connect()
	db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
})

describe('SQLiteStatement — execute', () => {
	it('returns the change count and the inserted rowid', () => {
		const result = db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u1', 'Ada', 36])
		expect(result.changes).toBe(1)
		expect(typeof result.rowid).toBe('number')
		expect(result.rowid).toBeGreaterThan(0)
	})

	it('counts every row an UPDATE touches', () => {
		seedUsers(db)
		const result = db.prepare('UPDATE users SET age = age + 1').execute()
		expect(result.changes).toBe(3)
	})
})

describe('SQLiteStatement — parameter binding', () => {
	it('binds positional parameters to ? placeholders', () => {
		db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u1', 'Ada', 36])
		expect(db.prepare('SELECT name FROM users WHERE id = ?').get(['u1'])).toEqual({ name: 'Ada' })
	})

	it('binds named parameters from a bare-keyed record', () => {
		db.prepare('INSERT INTO users VALUES (:id, :name, :age)').execute({
			id: 'u2',
			name: 'Lin',
			age: 29,
		})
		expect(db.prepare('SELECT name FROM users WHERE id = :id').get({ id: 'u2' })).toEqual({
			name: 'Lin',
		})
	})
})

describe('SQLiteStatement — get / all / iterate', () => {
	it('get returns the first row, or undefined on a miss', () => {
		seedUsers(db)
		expect(db.prepare('SELECT id FROM users WHERE id = ?').get(['u1'])).toEqual({ id: 'u1' })
		expect(db.prepare('SELECT id FROM users WHERE id = ?').get(['nope'])).toBeUndefined()
	})

	it('all returns every matching row', () => {
		seedUsers(db)
		const rows = db.prepare('SELECT id FROM users ORDER BY id').all()
		expect(rows).toEqual([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }])
	})

	it('iterate yields rows lazily', () => {
		seedUsers(db)
		const iterator = db.prepare('SELECT id FROM users ORDER BY id').iterate()
		const ids: SQLiteRow[] = []
		for (const row of iterator) ids.push(row)
		expect(ids).toEqual([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }])
	})

	it('maps a mid-stream native fault (a later row) to a SQLiteError instead of throwing raw', () => {
		db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
		db.prepare('INSERT INTO t VALUES (?, ?)').execute([1, 1])
		db.prepare('INSERT INTO t VALUES (?, ?)').execute([2, 9007199254740993n])
		const iterator = db.prepare('SELECT value FROM t ORDER BY id').iterate()
		expect(iterator.next().value).toEqual({ value: 1 })
		expect(sqliteErrorCode(() => iterator.next())).toBe('UNKNOWN')
	})
})

describe('SQLiteStatement — abandoned iterate', () => {
	const scratch = createScratch({ prefix: 'sqlite-statement-test-' })
	afterAll(() => scratch.destroy())

	// A `break` out of the `for...of` the guide recommends for large result sets
	// completes the wrapper's generator at its `yield`, so only a `finally` around
	// the pull loop reaches the native iterator's own `return`. Without it the
	// stepped native statement keeps its read transaction open, and a second
	// connection's COMMIT reports BUSY after its timeout elapses.
	it('releases the read lock when a caller breaks out of iterate', () => {
		const path = join(scratch.path, 'abandoned.db')
		const reader = createSQLiteDatabase({ path })
		reader.connect()
		reader.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
		seedUsers(reader)

		const statement = reader.prepare('SELECT id FROM users ORDER BY id')
		for (const row of statement.iterate()) {
			expect(row).toEqual({ id: 'u1' })
			break
		}

		const writer = createSQLiteDatabase({ path, timeout: 50 })
		writer.connect()
		writer.begin()
		writer.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u4', 'Sam', 22])
		expect(sqliteErrorCode(() => writer.commit())).toBe('NO_THROW')

		writer.close()
		reader.close()
	})

	// A `break` closes the iterator through the language's own IteratorClose, which
	// propagates whatever the `finally` raises — so a fault finalizing the native
	// iterator escapes raw to the caller unless the call is guarded. Closing the
	// database inside the loop is the reachable way to finalize an iterator whose
	// connection is already gone.
	it('finalizes without throwing when a caller closes the database inside the loop', () => {
		seedUsers(db)
		const statement = db.prepare('SELECT id FROM users ORDER BY id')
		const seen: SQLiteRow[] = []
		const code = sqliteErrorCode(() => {
			for (const row of statement.iterate()) {
				seen.push(row)
				db.close()
				break
			}
		})
		expect(seen).toEqual([{ id: 'u1' }])
		expect(code).toBe('NO_THROW')
	})
})

describe('SQLiteStatement — constraints', () => {
	it('surfaces a primary-key violation as a CONSTRAINT SQLiteError', () => {
		db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u1', 'Ada', 36])
		expect(
			sqliteErrorCode(() =>
				db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u1', 'Bo', 1]),
			),
		).toBe('CONSTRAINT')
	})
})

describe('SQLiteStatement — closed connection', () => {
	it('gates execute / get / all / iterate with CLOSED after the owning connection is closed', () => {
		const statement = db.prepare('SELECT id FROM users')
		db.close()
		expect(sqliteErrorCode(() => statement.execute())).toBe('CLOSED')
		expect(sqliteErrorCode(() => statement.get())).toBe('CLOSED')
		expect(sqliteErrorCode(() => statement.all())).toBe('CLOSED')
		expect(sqliteErrorCode(() => statement.iterate())).toBe('CLOSED')
	})

	it('stays CLOSED for a statement prepared on the old connection after reconnect', () => {
		const statement = db.prepare('SELECT id FROM users')
		db.close()
		db.connect()
		expect(sqliteErrorCode(() => statement.get())).toBe('CLOSED')
	})
})
