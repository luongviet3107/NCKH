// Đồng bộ nhãn giao diện với nhãn báo cáo; không đổi các khóa kỹ thuật của API.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'frontend/src/i18n/messages.ts'), 'utf8')
const marker = 'const vi: Dictionary = '
const start = source.indexOf(marker) + marker.length
const end = source.indexOf('\nconst en:')
if (start < marker.length || end < start) throw new Error('Không tìm thấy từ điển tiếng Việt')
const labels = vm.runInNewContext(`(${source.slice(start, end).trim()})`, Object.create(null), { timeout: 1000 })
const extras = Object.fromEntries(
  fs.readFileSync(path.join(root, 'backend/app/core/vi_extra.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes(' => '))
    .map((line) => {
      const separator = line.indexOf(' => ')
      return [line.slice(0, separator), line.slice(separator + 4)]
    }),
)
fs.writeFileSync(path.join(root, 'backend/app/core/vi_labels.json'), `${JSON.stringify(labels, null, 2)}\n`)
fs.writeFileSync(path.join(root, 'frontend/src/i18n/extra-messages.ts'),
  `// Được tạo bởi scripts/sync_translations.mjs từ backend/app/core/vi_extra.txt.\nexport const viExtra: Record<string, string> = ${JSON.stringify(extras, null, 2)}\n`)
console.log(`Đã đồng bộ ${Object.keys(labels).length} nhãn và ${Object.keys(extras).length} nhãn bổ sung.`)
