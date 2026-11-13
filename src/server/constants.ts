// The wrapper's numeric SQLite result codes.

/**
 * Names the SQLite result code whose low byte, `19`, flags a constraint violation.
 *
 * @remarks
 * A native `errcode` packs the primary result in its low byte, with extended codes
 * in the high bits (for example `SQLITE_CONSTRAINT_UNIQUE`), so the low byte is masked off
 * before comparing. Read only by `wrapError`.
 *
 * @example
 * ```ts
 * import { SQLITE_CONSTRAINT } from '@orkestrel/sqlite'
 *
 * SQLITE_CONSTRAINT === (1555 & 0xff) // true: 1555 is SQLITE_CONSTRAINT_PRIMARYKEY
 * ```
 */
export const SQLITE_CONSTRAINT = 19

/**
 * Names the SQLite result code whose low byte, `5`, flags a locked-database fault.
 *
 * @remarks
 * A native `errcode` packs the primary result in its low byte, with extended codes
 * in the high bits, so the low byte is masked off before comparing. Read only by
 * `wrapError`.
 *
 * @example
 * ```ts
 * import { SQLITE_BUSY } from '@orkestrel/sqlite'
 *
 * SQLITE_BUSY === (517 & 0xff) // true: 517 is SQLITE_BUSY_SNAPSHOT
 * ```
 */
export const SQLITE_BUSY = 5
