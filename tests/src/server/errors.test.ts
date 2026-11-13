import { SQLiteError, isSQLiteError } from '@src/server'
import { describe, expect, it } from 'vitest'

describe('isSQLiteError', () => {
	it('accepts a class-instance context', () => {
		class Context {
			readonly [key: string]: unknown
			readonly offset = 8
		}

		const context: Readonly<Record<string, unknown>> = new Context()
		const error = new SQLiteError('CLOSED', 'closed', context)
		expect(isSQLiteError(error)).toBe(true)
	})

	it('accepts a callable context', () => {
		const members: Readonly<Record<string, unknown>> = { offset: 8 }
		const context = Object.assign(() => undefined, members)
		const error = new SQLiteError('CLOSED', 'closed', context)
		expect(isSQLiteError(error)).toBe(true)
	})

	it('refuses a branded error whose code is outside the declared codes', () => {
		const error = new SQLiteError('CLOSED', 'Database is not connected')
		Object.defineProperty(error, 'code', { value: 'LOCKED' })
		expect(isSQLiteError(error)).toBe(false)
	})

	it('refuses a branded error whose context is neither an object nor callable', () => {
		const error = new SQLiteError('CLOSED', 'Database is not connected')
		Object.defineProperty(error, 'context', { value: 'users' })
		expect(isSQLiteError(error)).toBe(false)
	})

	// The guard reads the global `Error` captured at load, so a later replacement of the
	// global changes neither the instance check nor the `Error.prototype` comparison.
	it('reads the global Error captured at load for the instance check', () => {
		const error = new SQLiteError('CLOSED', 'Database is not connected')
		const lookalike = Object.assign(new Error('Database is not connected'), { code: 'CLOSED' })
		const original = globalThis.Error
		Reflect.set(globalThis, 'Error', RangeError)
		try {
			expect(isSQLiteError(error)).toBe(true)
			expect(isSQLiteError(lookalike)).toBe(false)
		} finally {
			Reflect.set(globalThis, 'Error', original)
		}
	})

	it('reads the global Error captured at load for the prototype comparison', () => {
		const error = new SQLiteError('CLOSED', 'Database is not connected')
		const lookalike = Object.assign(new Error('Database is not connected'), { code: 'CLOSED' })
		const original = globalThis.Error
		Reflect.set(globalThis, 'Error', SQLiteError)
		try {
			expect(isSQLiteError(error)).toBe(true)
			expect(isSQLiteError(lookalike)).toBe(false)
		} finally {
			Reflect.set(globalThis, 'Error', original)
		}
	})
})
