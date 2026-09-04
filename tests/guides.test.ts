// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest, and transcribes every flagship fence of
// `guides/sqlite.md` against the real `@src/server` barrel. The constants that follow are
// this package's own, and are the only part a sibling package changes.

import type { SQLiteDatabaseInterface, SQLiteRow } from '@src/server'
import { afterAll, describe, expect, it } from 'vitest'
import {
	computeSymbolKey,
	createGuide,
	createSource,
	createSourceManager,
	extractFenceImports,
	findMissing,
	findMissingSymbols,
	findUnexampled,
	findUnlisted,
	isExternalLink,
	parseManifest,
	resolveLink,
} from '@orkestrel/guide'
import { bindParameters, createSQLiteDatabase, isSQLiteError, wrapError } from '@src/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requireValue } from '@orkestrel/test'
import { createScratch, readInventory } from '@orkestrel/test/server'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** Each import specifier this package's own guides may resolve against. */
const MODULES = Object.freeze({ '@orkestrel/sqlite': 'src/server', '@src/server': 'src/server' })
/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its single consumer cannot become a
 * local, so it stays exported without being public. Naming it here is what makes that
 * intentional rather than forgotten — and the second assertion below fails when a name
 * here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([])

/** Root-level files this package's guides link to. `readInventory` walks directories only. */
const ROOT_FILES = Object.freeze(['AGENTS.md'])

const root = new URL('../', import.meta.url)
const files: Record<string, string> = {
	...readInventory(root, ['src', 'guides', 'tests'], { extensions: ['.ts', '.md'] }),
}
for (const name of ROOT_FILES) files[name] = readFileSync(new URL(name, root), 'utf8')
const manifest = parseManifest(
	requireValue(files['guides/README.md'], 'Missing file: guides/README.md'),
	'guides',
)
const sources = createSourceManager({ files, modules: MODULES })

it('manifest lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
})

for (const entry of manifest) {
	const guide = createGuide(requireValue(files[entry.spec], `Missing file: ${entry.spec}`))
	const source = createSource({ files, module: entry.source })

	describe(`${entry.concept}`, () => {
		it('uses only listed fence languages', () => {
			expect(findUnlisted(guide.fences(), FENCE_LANGUAGES)).toEqual([])
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

		for (const group of guide.methods()) {
			const members = source.methods(group.interface)
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface}`, () => {
				it('documents at least one method', () => {
					expect(group.methods.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, group.methods)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(group.methods, members)).toEqual([])
				})
				it(`${entity} exposes no undocumented method`, () => {
					const extra =
						entity === group.interface ? [] : findMissing(source.methods(entity), group.methods)
					expect(extra).toEqual([])
				})
			})
		}

		it('documents an example for every Surface function', () => {
			const fences = guide
				.fences()
				.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
				.map((fence) => fence.code)
			const names = guide
				.surface()
				.filter((symbol) => symbol.keyword === 'function')
				.map((symbol) => symbol.name)
			expect(findUnexampled(names, fences, source.examples())).toEqual([])
		})

		for (const group of guide.methods()) {
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface} examples`, () => {
				it('documents an example for every method', () => {
					const fences = guide
						.fences()
						.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
						.map((fence) => fence.code)
					const examples =
						entity === group.interface
							? source.examples(group.interface)
							: source.examples(group.interface).concat(source.examples(entity))
					expect(findUnexampled(group.methods, fences, examples)).toEqual([])
				})
			})
		}

		it('imports only real exports in every ```ts fence', () => {
			const fences = guide.fences().filter((fence) => fence.language === EXAMPLE_LANGUAGE)
			for (const fence of fences) {
				for (const { specifier, names } of extractFenceImports(fence.code)) {
					const imported = sources.source(specifier)
					if (imported === undefined) continue
					const surface = imported.surface().map((symbol) => symbol.name)
					expect(findMissing(names, surface)).toEqual([])
				}
			}
		})

		it('resolves every relative link', () => {
			const broken = guide
				.links()
				.filter((href) => !isExternalLink(href))
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(broken).toEqual([])
		})
		it('links only to test files that exist', () => {
			const missing = guide
				.tests()
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(missing).toEqual([])
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
		expect(db.prepare('SELECT name FROM users WHERE age >= ?').all([18])).toEqual([{ name: 'Ada' }])
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
