// Server-test setup — node-only helpers, loaded after `setup.ts` for the node
// `src:server` test project.

import { isSQLiteError } from '@src/server'

// Run `action`, returning a thrown `SQLiteError`'s `code` (or a sentinel) — so an
// error code is asserted unconditionally, never inside a conditional `expect`.
// Shared by the SQLite wrapper tests that branch on a fault's code.
export function sqliteErrorCode(action: () => unknown): string {
	try {
		action()
		return 'NO_THROW'
	} catch (error) {
		return isSQLiteError(error) ? error.code : 'NOT_SQLITE_ERROR'
	}
}
