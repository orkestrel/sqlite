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
})
