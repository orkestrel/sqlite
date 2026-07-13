import type { SQLiteRow } from '@src/server'
import { createSQLiteDatabase } from '@src/server'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SQLiteDatabaseInterface } from '@src/server'
import { sqliteErrorCode } from '../../setupServer.js'

// SQLiteStatement over a real in-memory database (no mocks, AGENTS §16) — run's
// result shape, positional (`?`) and named (a record) parameter binding, get /
// all / iterate, and a constraint violation surfacing as a CONSTRAINT
// SQLiteError. A fresh seeded database per test keeps each deterministic.

let db: SQLiteDatabaseInterface

beforeEach(() => {
	db = createSQLiteDatabase()
	db.connect()
	db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
})

describe('SQLiteStatement — run', () => {
	it('returns the change count and the inserted rowid', () => {
		const result = db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(['u1', 'Ada', 36])
		expect(result.changes).toBe(1)
		expect(typeof result.rowid).toBe('number')
		expect(result.rowid).toBeGreaterThan(0)
	})

	it('counts every row an UPDATE touches', () => {
		seed()
		const result = db.prepare('UPDATE users SET age = age + 1').run()
		expect(result.changes).toBe(3)
	})
})

describe('SQLiteStatement — parameter binding', () => {
	it('binds positional parameters to ? placeholders', () => {
		db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(['u1', 'Ada', 36])
		expect(db.prepare('SELECT name FROM users WHERE id = ?').get(['u1'])).toEqual({ name: 'Ada' })
	})

	it('binds named parameters from a bare-keyed record', () => {
		db.prepare('INSERT INTO users VALUES (:id, :name, :age)').run({
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
		seed()
		expect(db.prepare('SELECT id FROM users WHERE id = ?').get(['u1'])).toEqual({ id: 'u1' })
		expect(db.prepare('SELECT id FROM users WHERE id = ?').get(['nope'])).toBeUndefined()
	})

	it('all returns every matching row', () => {
		seed()
		const rows = db.prepare('SELECT id FROM users ORDER BY id').all()
		expect(rows).toEqual([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }])
	})

	it('iterate yields rows lazily', () => {
		seed()
		const iterator = db.prepare('SELECT id FROM users ORDER BY id').iterate()
		const ids: SQLiteRow[] = []
		for (const row of iterator) ids.push(row)
		expect(ids).toEqual([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }])
	})

	it('maps a mid-stream native fault (a later row) to a SQLiteError instead of throwing raw', () => {
		db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
		db.prepare('INSERT INTO t VALUES (?, ?)').run([1, 1])
		db.prepare('INSERT INTO t VALUES (?, ?)').run([2, 9007199254740993n])
		const iterator = db.prepare('SELECT value FROM t ORDER BY id').iterate()
		expect(iterator.next().value).toEqual({ value: 1 })
		expect(sqliteErrorCode(() => iterator.next())).toBe('UNKNOWN')
	})
})

describe('SQLiteStatement — constraints', () => {
	it('surfaces a primary-key violation as a CONSTRAINT SQLiteError', () => {
		db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(['u1', 'Ada', 36])
		expect(
			sqliteErrorCode(() => db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(['u1', 'Bo', 1])),
		).toBe('CONSTRAINT')
	})
})

describe('SQLiteStatement — closed connection', () => {
	it('gates run / get / all / iterate with CLOSED once the owning connection is closed', () => {
		const statement = db.prepare('SELECT id FROM users')
		db.close()
		expect(sqliteErrorCode(() => statement.run())).toBe('CLOSED')
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

// Insert three deterministic users for the read tests.
function seed(): void {
	const insert = db.prepare('INSERT INTO users VALUES (?, ?, ?)')
	insert.run(['u1', 'Ada', 36])
	insert.run(['u2', 'Lin', 29])
	insert.run(['u3', 'Max', 41])
}
