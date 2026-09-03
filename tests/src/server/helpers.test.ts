import { createSQLiteDatabase, SQLiteError, bindParameters, wrapError } from '@src/server'
import { createScratch } from '@orkestrel/test/server'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
	captureNativeBusyError,
	captureNativeConstraintError,
	sqliteErrorCode,
} from '../../setupServer.js'

// The SQLite wrapper's boundary helpers as pure units, with no mocks:
// `wrapError` maps a thrown value to a typed `SQLiteError` (a real `node:sqlite`
// constraint fault → `'CONSTRAINT'` through the errcode mask, a non-error → `'UNKNOWN'`,
// an existing `SQLiteError` passes through), and `bindParameters` normalizes the
// wrapper's parameters to the native binding shape (array → positional, record →
// named). The native constraint and locked-database errors are produced authentically
// by `tests/setupServer.ts` — a duplicate primary key, and a second connection writing
// against a held `BEGIN IMMEDIATE` — never fabricated.

const scratch = createScratch({ prefix: 'sqlite-helpers-test-' })
afterAll(() => scratch.destroy())

describe('wrapError', () => {
	it('maps a real node:sqlite locked-database fault to BUSY through the errcode mask', () => {
		const wrapped = wrapError(captureNativeBusyError(join(scratch.path, 'busy.db')))
		expect(wrapped).toBeInstanceOf(SQLiteError)
		expect(wrapped.code).toBe('BUSY')
		expect(typeof wrapped.context?.errcode).toBe('number')
	})

	it('maps a real node:sqlite constraint fault to CONSTRAINT through the errcode mask', () => {
		const wrapped = wrapError(captureNativeConstraintError())
		expect(wrapped).toBeInstanceOf(SQLiteError)
		expect(wrapped.code).toBe('CONSTRAINT')
		// The native errcode is preserved in context (low byte 19 = SQLITE_CONSTRAINT).
		expect(typeof wrapped.context?.errcode).toBe('number')
	})

	it('maps a non-error input to UNKNOWN', () => {
		const wrapped = wrapError('not an error')
		expect(wrapped).toBeInstanceOf(SQLiteError)
		expect(wrapped.code).toBe('UNKNOWN')
		expect(wrapped.message).toBe('Unknown SQLite error')
		expect(wrapped.context).toBeUndefined() // no errcode to carry
	})

	it('preserves a plain Error message under UNKNOWN', () => {
		const wrapped = wrapError(new Error('boom'))
		expect(wrapped.code).toBe('UNKNOWN')
		expect(wrapped.message).toBe('boom')
	})

	it('returns an existing SQLiteError unchanged', () => {
		const original = new SQLiteError('CLOSED', 'already closed')
		expect(wrapError(original)).toBe(original)
	})

	it('surfaces a duplicate primary key as a CONSTRAINT SQLiteError end to end', () => {
		const db = createSQLiteDatabase()
		db.connect()
		db.execute('CREATE TABLE t (id TEXT PRIMARY KEY)')
		db.prepare('INSERT INTO t VALUES (?)').execute(['dup'])
		expect(sqliteErrorCode(() => db.prepare('INSERT INTO t VALUES (?)').execute(['dup']))).toBe(
			'CONSTRAINT',
		)
		db.close()
	})
})

describe('bindParameters', () => {
	it('normalizes an array to positional parameters', () => {
		expect(bindParameters(['u1', 36])).toEqual({ positional: ['u1', 36] })
	})

	it('normalizes a record to named parameters', () => {
		expect(bindParameters({ id: 'u1', age: 36 })).toEqual({ named: { id: 'u1', age: 36 } })
	})

	it('defaults to empty positional when omitted', () => {
		expect(bindParameters()).toEqual({ positional: [] })
	})

	it('binds an empty array as empty positional (not named)', () => {
		expect(bindParameters([])).toEqual({ positional: [] })
	})
})
