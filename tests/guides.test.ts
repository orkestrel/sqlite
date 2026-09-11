// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest. The constants that follow are this
// package's own, as is the executed section that closes the file.

import type { SQLiteDatabaseInterface, SQLiteRow } from '@src/server'
import { GuideCommand } from '@orkestrel/guide/server'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** The one guide this package sources, whose tagline the README pitch equals. */
const GUIDE_SPEC = 'guides/sqlite.md'
/** The package identity the guide manifest and package manifest must share. */
const PACKAGE_MODULE = '@orkestrel/sqlite'
/** Each import specifier this package's own guides may resolve against. */
const MODULES = Object.freeze({ [PACKAGE_MODULE]: 'src/server', '@src/server': 'src/server' })
/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its single consumer cannot become a
 * local, so it stays exported without being public. Naming it here is what makes that
 * intentional rather than forgotten — and the assertion that follows it fails when a name
 * here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([])

await new GuideCommand({
	root: new URL('../', import.meta.url),
	patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md', 'package.json'],
	modules: MODULES,
	languages: FENCE_LANGUAGES,
	language: EXAMPLE_LANGUAGE,
	reader: readInventory,
	runner: createVitest,
}).execute(async ({ files, report, rows }) => {
	const { isRecord, parseJSON } = await import('@orkestrel/contract')
	const { computeSymbolKey, findMissingSymbols } = await import('@orkestrel/guide')
	const { requireValue } = await import('@orkestrel/test')
	const { createScratch } = await import('@orkestrel/test/server')
	const { bindParameters, createSQLiteDatabase, isSQLiteError, wrapError } =
		await import('@src/server')
	const { join } = await import('node:path')
	const { afterAll, describe, expect, it } = await import('vitest')

	it('manifest lists at least one guide', () => {
		expect(report.input).toEqual([])
		expect(rows.length).toBeGreaterThan(0)
		expect(rows.map((row) => row.entry.spec)).toContain(GUIDE_SPEC)
	})

	// The example half of the equality case is silent over an empty population: with no
	// title on both sides `findDrift` compares no pair and the case passes on the summaries
	// alone. This pins the population this repository's own guide contributes, so removing
	// every `@example` title reddens the suite instead of quietly retiring half the gate.
	// The failure names both title sets, because a pin reporting only its own emptiness
	// leaves the reader to work out which side dropped the title.
	it('pairs at least one example title across the guide and the source', () => {
		expect(report.examples.titles.filter((finding) => finding.spec === GUIDE_SPEC)).toEqual([])
	})

	// The README's pitch and the guide's tagline are one text, each read as the blockquote
	// under its file's H1. `README.md` is outside the concept index, so the reader is
	// applied to it directly rather than through a manifest row. Each side is guarded
	// against `undefined` first, so a file that lost its blockquote reports that rather
	// than reporting two absences as agreement.
	it('opens the README with the guide tagline', () => {
		const manifest = parseJSON(requireValue(files['package.json'], 'Missing file: package.json'))
		expect(isRecord(manifest) ? manifest.name : undefined).toBe(PACKAGE_MODULE)
		expect(report.pitch).toEqual([])
	})

	for (const { entry, guide, source } of rows) {
		describe(`${entry.concept}`, () => {
			it('uses only listed fence languages', () => {
				expect(report.fences.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('extracts a non-empty documented surface', () => {
				expect(guide.surface().length).toBeGreaterThan(0)
			})
			it('re-exports every direct declaration that is not named internal', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
			})
			it('names no symbol internal that the barrel already exports', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
			})
			it('re-exports only direct declarations', () => {
				expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
			})
			it('documents every barrel export', () => {
				expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
			})
			it('documents only barrel exports', () => {
				expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
			})

			it('exposes no hidden module-scope declarations', () => {
				expect(source.hidden().map(computeSymbolKey)).toEqual([])
			})

			it('carries every required populated section', () => {
				expect(report.sections.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('keeps behavioral interfaces and implementing classes in parity', () => {
				expect(report.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('documents every behavioral declaration', () => {
				expect(report.declarations.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			// The equality gate: a `Summary` cell against its export's description paragraph, a
			// titled fence against the `@example` of that title. `findDrift` owns the comparison
			// and names both sides; converge the two sides through the native entry, never by
			// weakening this assertion. `findDrift` pairs an example only where a title is
			// present on both sides, so an untitled `@example` block is outside this case. Each
			// collected line is the spec, the key, and each side's text or `absent` — the same
			// worklist the native entry prints, so a failure here is read the way that command's
			// output is. Select source authority with `--to guide`, or guide authority with
			// `--to source`.
			it('keeps every compared summary and example equal to its source', () => {
				expect(report.drift.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('keeps the executable example population non-empty', () => {
				expect(report.examples.fences.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('documents an example for every Surface function', () => {
				expect(report.examples.functions.filter((finding) => finding.spec === entry.spec)).toEqual(
					[],
				)
			})

			it('documents an example for every method', () => {
				expect(report.examples.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('imports only real exports in every ```ts fence', () => {
				expect(report.imports.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('resolves every relative link', () => {
				expect(report.links.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})
			it('links only to test files that exist', () => {
				expect(report.tests.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})
		})
	}

	// ── Flagship fence transcriptions ────────────────────────────────────────────
	//
	// Each of the following blocks is one `guides/sqlite.md` fence, run against the real
	// `@src/server` barrel and asserting the value its comments claim. Name resolution is
	// not a behavioural proof, so a fence documenting a value the code contradicts passes
	// every preceding parity assertion and is caught only here. Change a fence, change its
	// transcription. The 'Branching on a typed fault', 'Production options', and 'Retrying
	// on BUSY' fences claim no return value — `tests/src/server` proves the behaviour each
	// of them illustrates.

	describe('flagship fences', () => {
		const scratch = createScratch({ prefix: 'sqlite-guides-test-' })
		afterAll(() => scratch.destroy())

		it('surfaces an insert result and an adult query', () => {
			const db = createSQLiteDatabase({ path: ':memory:' })
			db.connect()
			db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
			expect(db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u1', 'Ada', 36])).toEqual({
				changes: 1,
				rowid: 1,
			})
			expect(db.prepare('SELECT name FROM users WHERE age >= ?').all([18])).toEqual([
				{ name: 'Ada' },
			])
			db.close()
		})

		it('connects, executes, and round-trips a row', () => {
			const db = createSQLiteDatabase()
			db.connect()
			db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
			const result = db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u1', 'Ada', 36])
			expect(result.changes).toBe(1)
			expect(db.prepare('SELECT * FROM users WHERE id = ?').get(['u1'])).toEqual({
				id: 'u1',
				name: 'Ada',
				age: 36,
			})
			db.close()
		})

		it('binds positional and named parameters', () => {
			const db = createSQLiteDatabase()
			db.connect()
			db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
			db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u2', 'Lin', 29])
			db.prepare('INSERT INTO users VALUES (:id, :name, :age)').execute({
				id: 'u3',
				name: 'Max',
				age: 41,
			})
			expect(db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual([
				{ id: 'u2', name: 'Lin', age: 29 },
				{ id: 'u3', name: 'Max', age: 41 },
			])
			db.close()
		})

		it('reads through get, all, and iterate', () => {
			const db = createSQLiteDatabase()
			db.connect()
			db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
			db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u1', 'Ada', 36])
			db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u2', 'Lin', 29])

			expect(db.prepare('SELECT name FROM users WHERE id = ?').get(['u1'])).toEqual({ name: 'Ada' })
			expect(db.prepare('SELECT name FROM users WHERE id = ?').get(['nobody'])).toBeUndefined()
			expect(db.prepare('SELECT * FROM users ORDER BY age').all()).toEqual([
				{ id: 'u2', name: 'Lin', age: 29 },
				{ id: 'u1', name: 'Ada', age: 36 },
			])

			const streamed: SQLiteRow[] = []
			for (const row of db.prepare('SELECT id FROM users').iterate()) streamed.push(row)
			expect(streamed).toEqual([{ id: 'u1' }, { id: 'u2' }])
			db.close()
		})

		it('commits an atomic transaction together', () => {
			const db = createSQLiteDatabase()
			db.connect()
			db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
			db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u1', 'Ada', 36])
			db.transact(() => {
				db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u4', 'Sam', 22])
				db.prepare('UPDATE users SET age = age + 1 WHERE id = ?').execute(['u1'])
			})
			expect(db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual([
				{ id: 'u1', name: 'Ada', age: 37 },
				{ id: 'u4', name: 'Sam', age: 22 },
			])
			db.close()
		})

		// The guide's fence awaits the caller's own work between `begin` and `commit`;
		// `Promise.resolve()` stands in for it here.
		it('spans awaited caller work between begin and commit', async () => {
			const db = createSQLiteDatabase()
			db.connect()
			db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
			db.begin()
			try {
				db.prepare('INSERT INTO users VALUES (?, ?, ?)').execute(['u5', 'Kai', 19])
				await Promise.resolve()
				db.commit()
			} catch (error) {
				db.rollback()
				throw error
			}
			expect(db.prepare('SELECT * FROM users').all()).toEqual([{ id: 'u5', name: 'Kai', age: 19 }])

			expect(db.transacting).toBe(false)
			if (!db.transacting) db.begin()
			expect(db.transacting).toBe(true)
			db.rollback()
			db.close()
		})

		// A `:memory:` database answers `journal_mode` with `'memory'`, so the guide's
		// `'wal'` claim is only true of a file-backed database and is transcribed as one.
		it('reads a pragma, and sets then reads one', () => {
			const db = createSQLiteDatabase({ path: join(scratch.path, 'pragmas.db') })
			db.connect()
			expect(db.pragma('user_version')).toBe(0)
			expect(db.pragma('user_version', 7)).toBe(7)
			expect(db.pragma('journal_mode', 'WAL')).toBe('wal')
			db.close()
		})

		it('reports a closed connection as disconnected', () => {
			const db = createSQLiteDatabase()
			db.connect()
			expect(db.connected).toBe(true)
			db.close()
			expect(db.connected).toBe(false)
		})

		it('disposes the connection at the end of a using block', () => {
			let released: SQLiteDatabaseInterface | undefined
			{
				using db = createSQLiteDatabase()
				db.connect()
				db.execute('CREATE TABLE t (id INTEGER)')
				released = db
				expect(db.connected).toBe(true)
			}
			expect(released?.connected).toBe(false)
		})

		it('binds parameters and wraps a native throw through the boundary helpers', () => {
			expect(bindParameters(['u1', 'Ada'])).toEqual({ positional: ['u1', 'Ada'] })
			expect(bindParameters({ id: 'u1' })).toEqual({ named: { id: 'u1' } })

			const db = createSQLiteDatabase()
			db.connect()
			let wrapped: unknown
			try {
				db.execute('not sql')
			} catch (error) {
				wrapped = wrapError(error)
			}
			expect(isSQLiteError(wrapped)).toBe(true)
			db.close()
		})
	})
})
