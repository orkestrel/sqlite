import {
	createSQLiteDatabase,
	isSQLiteError,
	SQLiteError,
	bindParameters,
	wrapError,
} from '@src/server'
import { DatabaseSync } from 'node:sqlite'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { captureError } from '@orkestrel/test'

// The SQLite wrapper's boundary helpers as pure units (no mocks, AGENTS §16):
// `wrapError` maps a thrown value to a typed `SQLiteError` (a real `node:sqlite`
// constraint fault → `'CONSTRAINT'` via the errcode mask, a non-error → `'UNKNOWN'`,
// an existing `SQLiteError` passes through), and `bindParameters` normalizes the
// wrapper's parameters to the native binding shape (array → positional, record →
// named). The native constraint error is produced authentically — a duplicate
// primary key on a real in-memory database — never fabricated.

// Capture the native `node:sqlite` error a duplicate-PK insert throws, raw (before
// the wrapper maps it). Uses `node:sqlite` directly so `wrapError` sees the genuine
// native shape (`errcode` set) — the wrapper's own `run` would pre-wrap it.
function nativeConstraintError(): unknown {
	const database = new DatabaseSync(':memory:')
	database.exec('CREATE TABLE t (id TEXT PRIMARY KEY)')
	database.prepare('INSERT INTO t VALUES (?)').run('dup')
	try {
		database.prepare('INSERT INTO t VALUES (?)').run('dup')
		return undefined
	} catch (error) {
		return error
	} finally {
		database.close()
	}
}

// Capture the native `node:sqlite` error a locked-database write throws, raw
// (before the wrapper maps it) — a second connection writing while the first
// holds an uncommitted `BEGIN IMMEDIATE` transaction, with a short `timeout` so
// the lock fault surfaces promptly.
function nativeBusyError(): unknown {
	const path = join(tmpdir(), `sqlite-helpers-busy-${process.pid}-${Date.now()}.db`)
	const holder = new DatabaseSync(path)
	holder.exec('CREATE TABLE t (id INTEGER)')
	holder.exec('BEGIN IMMEDIATE')
	holder.prepare('INSERT INTO t VALUES (?)').run(1)
	const contender = new DatabaseSync(path, { timeout: 50 })
	try {
		contender.prepare('INSERT INTO t VALUES (?)').run(2)
		return undefined
	} catch (error) {
		return error
	} finally {
		contender.close()
		holder.exec('ROLLBACK')
		holder.close()
		rmSync(path, { force: true })
	}
}

describe('wrapError', () => {
	it('maps a real node:sqlite locked-database fault to BUSY via the errcode mask', () => {
		const wrapped = wrapError(nativeBusyError())
		expect(wrapped).toBeInstanceOf(SQLiteError)
		expect(wrapped.code).toBe('BUSY')
		expect(typeof wrapped.context?.errcode).toBe('number')
	})

	it('maps a real node:sqlite constraint fault to CONSTRAINT via the errcode mask', () => {
		const wrapped = wrapError(nativeConstraintError())
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
		db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)')
		db.prepare('INSERT INTO t VALUES (?)').run(['dup'])
		const caught = captureError(() => db.prepare('INSERT INTO t VALUES (?)').run(['dup']))
		db.close()
		expect(isSQLiteError(caught) ? caught.code : 'not-sqlite').toBe('CONSTRAINT')
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
