import assert from 'node:assert/strict'
import test from 'node:test'

import { createServer } from '../src/server.mjs'

test('serves the application and task API', async t => {
  const server = createServer().listen(0, '127.0.0.1')
  t.after(() => server.close())
  await new Promise(resolve => server.once('listening', resolve))
  const { port } = server.address()

  const page = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Signal Board/)

  const api = await fetch(`http://127.0.0.1:${port}/api/tasks`)
  assert.equal(api.status, 200)
  const payload = await api.json()
  assert.equal(payload.tasks.length, 3)
})
