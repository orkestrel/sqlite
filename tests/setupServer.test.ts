import { createSQLiteDatabase, SQLiteError, SQLITE_BUSY, SQLITE_CONSTRAINT } from '@src/server'
import { isObject } from '@orkestrel/contract'
import { createScratch } from '@orkestrel/test/server'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
	captureNativeBusyError,
	captureNativeConstraintError,
	lockDatabase,
	seedUsers,
	sqliteErrorCode,
} from './setupServer.js'

// tests/setupServer.test.ts — proves the Node-only helpers the server suites share:
// `sqliteErrorCode` asserting an error code unconditionally, `seedUsers` filling a
// `users` table, and the scenario builders `captureNativeConstraintError`,
// `lockDatabase`, and `captureNativeBusyError` that produce genuine native faults.
// This module has no browser or service half: `tests/setupServer.ts` is Node-only
// server test infrastructure, so every contract below is proven here in full.

const scratch = createScratch({ prefix: 'sqlite-setup-server-test-' })
afterAll(() => scratch.destroy())

describe('sqliteErrorCode', () => {
	it('returns the thrown SQLiteError code', () => {
		const code = 'CONSTRAINT'
		expect(
			sqliteErrorCode(() => {
				throw new SQLiteError(code, 'unique constraint failed')
			}),
		).toBe(code)
	})

	it('returns NOT_SQLITE_ERROR for a thrown value that is not a SQLiteError', () => {
		expect(
			sqliteErrorCode(() => {
				throw new TypeError('not a sqlite fault')
			}),
		).toBe('NOT_SQLITE_ERROR')
	})

	it('returns NO_THROW when action does not throw', () => {
		expect(sqliteErrorCode(() => 'unrelated result')).toBe('NO_THROW')
	})
})

describe('seedUsers', () => {
	it('inserts the deterministic users in id order', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
		seedUsers(db)
		expect(db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual([
			{ id: 'u1', name: 'Ada', age: 36 },
			{ id: 'u2', name: 'Lin', age: 29 },
			{ id: 'u3', name: 'Max', age: 41 },
		])
		db.close()
	})
})

describe('captureNativeConstraintError', () => {
	it('returns the raw native error carrying the SQLITE_CONSTRAINT result code', () => {
		const error = captureNativeConstraintError()
		expect(error).toBeInstanceOf(Error)
		expect(
			isObject(error) && 'errcode' in error && typeof error.errcode === 'number'
				? error.errcode & 0xff
				: undefined,
		).toBe(SQLITE_CONSTRAINT)
	})
})

describe('lockDatabase', () => {
	it('holds an open transaction that locks the file against another connection', () => {
		const path = join(scratch.path, 'lock.db')
		const holder = lockDatabase(path)
		expect(holder.isTransaction).toBe(true)

		const contender = createSQLiteDatabase({ path, timeout: 50 })
		contender.connect()
		expect(sqliteErrorCode(() => contender.execute('INSERT INTO t VALUES (2)'))).toBe('BUSY')
		contender.close()

		holder.exec('ROLLBACK')
		holder.close()
	})
})

describe('captureNativeBusyError', () => {
	it('returns the raw native error carrying the SQLITE_BUSY result code', () => {
		const error = captureNativeBusyError(join(scratch.path, 'busy.db'))
		expect(error).toBeInstanceOf(Error)
		expect(
			isObject(error) && 'errcode' in error && typeof error.errcode === 'number'
				? error.errcode & 0xff
				: undefined,
		).toBe(SQLITE_BUSY)
	})

	it('releases both connections, so a later write to the same file succeeds', () => {
		const path = join(scratch.path, 'released.db')
		captureNativeBusyError(path)

		const writer = createSQLiteDatabase({ path, timeout: 50 })
		writer.connect()
		expect(sqliteErrorCode(() => writer.execute('INSERT INTO t VALUES (3)'))).toBe('NO_THROW')
		expect(writer.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 1 })
		writer.close()
	})
})
