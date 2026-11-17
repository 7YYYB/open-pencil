import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveWorkspaceRoot } from '@open-pencil/package-artifacts-tools'

const root = await resolveWorkspaceRoot(process.cwd())
const output = join(root, 'target', 'release', 'Board-Studio-Portable')
await mkdir(join(output, 'licenses'), { recursive: true })

const files = [
  ['target/release/BoardStudio.exe', 'BoardStudio.exe'],
  ['desktop/board-studio-portable.txt', '使用说明.txt'],
  ['LICENSE', 'licenses/LICENSE-OpenPencil.txt'],
  ['dist/THIRD-PARTY-NOTICES.md', 'licenses/THIRD-PARTY-NOTICES-JAVASCRIPT.md'],
  ['desktop/generated/THIRD-PARTY-NOTICES.md', 'licenses/THIRD-PARTY-NOTICES-RUST.md']
] as const

for (const [source, destination] of files) {
  await copyFile(join(root, source), join(output, destination))
}

console.log(`Portable app: ${output}`)
