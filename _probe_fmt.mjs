import { readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let apiKey
try {
  const cred = readFileSync(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8')
  const m = cred.match(/^OPENCODE_GO_API_KEY\s*:\s*(.+)$/m) || cred.match(/^OPENCODE_API_KEY\s*:\s*(.+)$/m)
  apiKey = m?.[1]?.trim()
  if (apiKey) apiKey = apiKey.replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '')
} catch {}
apiKey = apiKey || process.env.OPENCODE_GO_API_KEY || process.env.OPENCODE_API_KEY
if (!apiKey) { console.log('NO_KEY_FOUND'); process.exit(2) }

const URL = 'https://opencode.ai/zen/go/v1/chat/completions'
const MODEL = 'mimo-v2.5'
const dir = 'D:/project/AIproject/mimo-vision/_fmt'

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }

for (const f of readdirSync(dir).sort()) {
  const ext = path.extname(f).toLowerCase()
  const b64 = readFileSync(path.join(dir, f)).toString('base64')
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: [
        { type: 'text', text: 'What is the dominant color of this image? Answer with ONE word only.' },
        { type: 'image_url', image_url: { url: `data:${MIME[ext]};base64,${b64}` } },
      ] }] }),
      signal: AbortSignal.timeout(60000),
    })
    const j = await r.json()
    const content = j.choices?.[0]?.message?.content ?? (j.error ? 'ERROR ' + JSON.stringify(j.error).slice(0, 150) : '(no content)')
    const word = typeof content === 'string' ? content.replace(/\s+/g, ' ').trim().slice(0, 60) : JSON.stringify(content)
    console.log(`${f.padEnd(12)} => HTTP ${r.status}  ${word}`)
  } catch (e) {
    console.log(`${f.padEnd(12)} => ERR ${e.message}`)
  }
}
