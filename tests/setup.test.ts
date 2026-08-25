import * as setup from './setup.js'
import { describe, expect, it } from 'vitest'

// tests/setup.test.ts — proves `tests/setup.ts`, `setupFiles[0]` for every Vitest project. The
// module is deliberately export-free: it pins that loading it first contributes nothing to any
// project, including the host-free `src:core`/`app:core` projects a helper landing here by
// accident would silently leak into.

describe('setup', () => {
	it('adds no export', () => {
		expect(Object.keys(setup)).toEqual([])
	})
})
