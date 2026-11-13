import type { Guard } from '@orkestrel/contract'
import { andOf, boundsOf, isInteger, stringOf, unionOf } from '@orkestrel/contract'

/**
 * Checks whether a value is a pragma name `pragma` can write into `PRAGMA` text: ASCII
 * letters, digits, and underscores, opening with a letter or an underscore.
 *
 * @remarks
 * A pragma name cannot be bound as a parameter, so the syntax admits one bare name and
 * nothing that can end it: no schema prefix, quote, space, bracket, or `;`. Whether the
 * engine knows the name is not checked.
 *
 * @example
 * ```ts
 * import { isPragmaName } from '@orkestrel/sqlite'
 *
 * isPragmaName('journal_mode') // true
 * isPragmaName('main.journal_mode') // false
 * ```
 */
export const isPragmaName: Guard<string> = stringOf({ pattern: /^[A-Za-z_][A-Za-z0-9_]*$/ })

/**
 * Checks whether a value is a pragma value `pragma` can write into `PRAGMA` text: a 32-bit
 * signed integer, or a keyword of ASCII letters and underscores.
 *
 * @remarks
 * A pragma value cannot be bound as a parameter, so a string is admitted only as a bare
 * keyword such as `WAL`; a quoted literal, a numeric string, and a space are refused. An
 * integer from `-2147483648` to `2147483647` is admitted. Every other number is refused,
 * because SQLite misreads it without an error: an integer pragma sets `0` for `2147483648`
 * and `1` for `1e21`. A pragma that takes a 64-bit value above that range, such as
 * `mmap_size` past 2 GiB, is refused until a consumer needs it.
 *
 * @example
 * ```ts
 * import { isPragmaValue } from '@orkestrel/sqlite'
 *
 * isPragmaValue('WAL') // true
 * isPragmaValue(-2000) // true
 * isPragmaValue(2147483648) // false
 * isPragmaValue('WAL; PRAGMA case_sensitive_like = ON') // false
 * ```
 */
export const isPragmaValue: Guard<string | number> = unionOf(
	andOf(isInteger, boundsOf(-2147483648, 2147483647)),
	stringOf({ pattern: /^[A-Za-z_]+$/ }),
)
