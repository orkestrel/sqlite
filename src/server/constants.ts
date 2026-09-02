// The wrapper's numeric SQLite result codes (AGENTS §5 constants file).

/**
 * Names the SQLite result code for a constraint violation.
 *
 * @remarks
 * A native `errcode` packs the primary result in its low byte, with extended codes
 * in the high bits (e.g. `SQLITE_CONSTRAINT_UNIQUE`), so the low byte is masked off
 * before comparing. Read only by `wrapError`.
 */
export const SQLITE_CONSTRAINT = 19

/**
 * Names the SQLite result code for a locked-database fault.
 *
 * @remarks
 * A native `errcode` packs the primary result in its low byte, with extended codes
 * in the high bits, so the low byte is masked off before comparing. Read only by
 * `wrapError`.
 */
export const SQLITE_BUSY = 5
