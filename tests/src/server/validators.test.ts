import { isPragmaName, isPragmaValue } from '@src/server'
import { describe, expect, it } from 'vitest'
import {
	ADMITTED_PRAGMA_NAMES,
	ADMITTED_PRAGMA_VALUES,
	REFUSED_PRAGMA_NAMES,
	REFUSED_PRAGMA_VALUES,
	UNTYPED_PRAGMA_INPUTS,
} from '../../setupServer.js'

// The pragma guards over their declared syntax, with each adjacent refusal named in a
// table, and their totality over every input that is neither a string nor a number.

describe('isPragmaName', () => {
	it.for(ADMITTED_PRAGMA_NAMES)('admits %s', (name) => {
		expect(isPragmaName(name)).toBe(true)
	})

	it.for(REFUSED_PRAGMA_NAMES)('refuses $label', ({ input }) => {
		expect(isPragmaName(input)).toBe(false)
	})

	it('refuses a number, which the value syntax admits', () => {
		expect(isPragmaName(7)).toBe(false)
		expect(isPragmaName(Number.NaN)).toBe(false)
	})
})

describe('isPragmaValue', () => {
	it.for(ADMITTED_PRAGMA_VALUES)('admits %s', (value) => {
		expect(isPragmaValue(value)).toBe(true)
	})

	it.for(REFUSED_PRAGMA_VALUES)('refuses $label', ({ input }) => {
		expect(isPragmaValue(input)).toBe(false)
	})
})

describe('pragma guard totality', () => {
	it.for(UNTYPED_PRAGMA_INPUTS)('refuses %s in both guards', (input) => {
		expect(isPragmaName(input)).toBe(false)
		expect(isPragmaValue(input)).toBe(false)
	})

	it('refuses a revoked proxy without throwing', () => {
		const { proxy, revoke } = Proxy.revocable({}, {})
		revoke()
		expect(isPragmaName(proxy)).toBe(false)
		expect(isPragmaValue(proxy)).toBe(false)
	})

	it('refuses an object that throws on read or coerces to an admitted text', () => {
		expect(
			isPragmaName({
				get length(): number {
					throw new Error('unreadable length')
				},
			}),
		).toBe(false)
		expect(isPragmaName({ toString: () => 'journal_mode' })).toBe(false)
		expect(isPragmaValue({ toString: () => 'WAL' })).toBe(false)
		expect(isPragmaValue({ valueOf: () => 7 })).toBe(false)
	})
})
