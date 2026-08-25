import { SQLiteError } from '@src/server'
import { describe, expect, it } from 'vitest'
import { sqliteErrorCode } from './setupServer.js'

// tests/setupServer.test.ts — proves `sqliteErrorCode`, the Node-only helper the
// server suites share to assert an error code unconditionally. This module has
// no browser or service half: `tests/setupServer.ts` is Node-only server test
// infrastructure, so every contract below is proven here in full.

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
