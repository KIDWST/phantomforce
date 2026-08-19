import { readFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const tasks = [
  { id: 1, status: 'completed', title: 'Map the customer journey' },
  { id: 2, status: 'in-progress', title: 'Verify the release candidate' },
  { id: 3, status: 'queued', title: 'Publish the field notes' }
]

const TYPES = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' }

export function createServer() {
  return http.createServer(async (request, response) => {
    if (request.url === '/api/tasks') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ tasks }))
      return
    }

    const requestPath = request.url === '/' ? '/public/index.html' : request.url
    const target = path.resolve(root, `.${requestPath}`)
    if (!target.startsWith(root)) {
      response.writeHead(403)
      response.end('Forbidden')
      return
    }

    try {
      const content = await readFile(target)
      response.writeHead(200, { 'content-type': TYPES[path.extname(target)] || 'application/octet-stream' })
      response.end(content)
    } catch {
      response.writeHead(404)
      response.end('Not found')
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(4177, '127.0.0.1', () => console.log('Signal Board: http://127.0.0.1:4177'))
}
