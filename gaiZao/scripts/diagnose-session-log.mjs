import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'

const root = process.argv[2]
const dirs = readdirSync(root).map(name => ({ name, path: join(root, name), mtime: statSync(join(root, name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime)
const dir = dirs[0]
console.log('dir:', dir.name)
const files = []
function walk(p) {
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const full = join(p, entry.name)
    if (entry.isDirectory()) { walk(full); continue }
    files.push({ path: full, size: statSync(full).size, mtime: statSync(full).mtimeMs })
  }
}
walk(dir.path)
files.sort((a, b) => b.mtime - a.mtime)
const target = files.find(f => f.path.endsWith('session.v4.jsonl.zstd'))
console.log('file:', target.path.slice(dir.path.length + 1), target.size)
const bytes = readFileSync(target.path)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const offsets = []
for (let i = 0; i + 4 <= bytes.length; i += 1) {
  if (bytes[i] === MAGIC[0] && bytes[i + 1] === MAGIC[1] && bytes[i + 2] === MAGIC[2] && bytes[i + 3] === MAGIC[3]) offsets.push(i)
}
console.log('frames:', offsets.length)
const parts = []
let failures = 0
for (let i = 0; i < offsets.length; i += 1) {
  const start = offsets[i]
  const end = i + 1 < offsets.length ? offsets[i + 1] : bytes.length
  try { parts.push(zlib.zstdDecompressSync(bytes.subarray(start, end)).toString('utf8')) } catch { failures += 1 }
}
const text = parts.join('')
console.log('decompressed length:', text.length, 'failures:', failures)
const lines = text.split('\n').filter(Boolean)
console.log('lines:', lines.length)
for (const keyword of ['trialPrompt', 'velagent_', 'canvas_timeout', '试运行']) {
  const hits = lines.filter(line => line.includes(keyword))
  console.log('keyword', keyword, 'hits', hits.length)
  for (const hit of hits.slice(-2)) console.log('   ', hit.slice(0, 500))
}
console.log('tail events:')
for (const line of lines.slice(-8)) console.log('   ', line.slice(0, 320))
