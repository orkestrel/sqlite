import { DatabaseSync } from 'node:sqlite'
import { createSQLiteDatabase } from '@src/server'
import { expect, it } from 'vitest'

// A repeated point read on a held and on a re-prepared statement, through the wrapper and through the
// driver alone. The difference between a wrapper arm and its driver arm is the wrapper term; the
// difference between a held and a re-prepared arm is the preparation a driver statement cache saves.

const ROWS = 1000

it('reads the wrapper term of a repeated point read', async ({ bench }) => {
	using wrapped = createSQLiteDatabase()
	wrapped.connect()
	wrapped.execute('CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
	const insert = wrapped.prepare('INSERT INTO items VALUES (?, ?, ?)')
	for (const index of Array.from({ length: ROWS }, (_, at) => at)) {
		insert.execute([`k${index}`, `n${index}`, index])
	}
	const select = 'SELECT name, age FROM items WHERE id = ?'
	const heldWrapper = wrapped.prepare(select)

	const raw = new DatabaseSync(':memory:')
	raw.exec('CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
	const rawInsert = raw.prepare('INSERT INTO items VALUES (?, ?, ?)')
	for (const index of Array.from({ length: ROWS }, (_, at) => at)) {
		rawInsert.run(`k${index}`, `n${index}`, index)
	}
	const heldRaw = raw.prepare(select)

	const result = await bench.compare(
		bench('wrapper held', () => {
			heldWrapper.get(['k500'])
		}),
		bench('driver held', () => {
			heldRaw.get('k500')
		}),
		bench('driver held again', () => {
			heldRaw.get('k500')
		}),
		bench('wrapper prepared each read', () => {
			wrapped.prepare(select).get(['k500'])
		}),
		bench('driver prepared each read', () => {
			raw.prepare(select).get('k500')
		}),
	)
	expect(result.get('wrapper held')).toBeFasterThan(result.get('wrapper prepared each read'))
	raw.close()
}, 600_000)
