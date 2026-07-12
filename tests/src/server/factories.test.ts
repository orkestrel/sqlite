import { createSQLiteDatabase } from '@src/server'
import { describe, expect, it } from 'vitest'

// The SQLite wrapper factory — that `createSQLiteDatabase` returns a working
// `SQLiteDatabaseInterface`. The full lifecycle / exec / transaction / pragma
// behavior lives in SQLiteDatabase.test.ts; here we only assert the factory wires
// up a usable handle and defaults its path.

describe('createSQLiteDatabase', () => {
	it('defaults the path to :memory: when no options are given', () => {
		expect(createSQLiteDatabase().path).toBe(':memory:')
	})

	it('returns a working database (connect → exec → prepare → round-trip)', () => {
		const db = createSQLiteDatabase()
		db.connect()
		expect(db.connected).toBe(true)
		db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)')
		db.prepare('INSERT INTO users VALUES (?, ?)').run(['u1', 'Ada'])
		expect(db.prepare('SELECT name FROM users WHERE id = ?').get(['u1'])).toEqual({ name: 'Ada' })
		db.close()
	})
})
