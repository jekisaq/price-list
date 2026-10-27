import { createHash } from 'node:crypto'
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
) as { version: string }
const installer = `Price-List-${version}-x64-Setup.exe`
// Verify the installer exists before creating a release directory.
await access(join(root, 'release', installer))
const destination = join(root, 'release', `Price-List-${version}-windows-x64`)
await mkdir(destination, { recursive: true })

async function copy(source: string, target: string) {
  const directory = join(destination, target)
  await mkdir(directory, { recursive: true })
  await copyFile(join(root, source), join(directory, basename(source)))
}
await copy(`release/${installer}`, '.')
await copy('docs/user-guide.md', '.')
await copy(`docs/releases/${version}.md`, '.')
await copy('samples/README.md', 'samples')
await copy('samples/csv/README.md', 'samples/csv')
await copy('samples/output/README.md', 'samples/output')
for (const directory of ['csv', 'xlsx', 'output']) {
  for (const entry of await readdir(join(root, 'samples', directory), {
    withFileTypes: true,
  })) {
    if (entry.isFile() && /\.(csv|xlsx)$/.test(entry.name))
      await copy(`samples/${directory}/${entry.name}`, `samples/${directory}`)

  }
}
await writeFile(
  join(destination, 'README.txt'),
  `Price List ${version} — Windows x64\r\n\r\n1. Run ${installer}.\r\n2. Read user-guide.md (Russian).\r\n3. Try samples/csv/supplier-basic.csv.\r\n4. Compare a 20% markup with samples/output/.\r\n\r\nNo Node.js, npm or Excel is required. The installer is unsigned.\r\nUninstall preserves profiles and exported files.\r\n`,
)

const hashes: string[] = []
async function hashFiles(directory: string, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name)
    const relative = prefix + entry.name
    if (entry.isDirectory()) {
      await hashFiles(path, `${relative}/`)
    } else if (entry.name !== 'SHA256SUMS.txt') {
      const hash = createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
      hashes.push(`${hash}  ${relative}`)
    }
  }
}
await hashFiles(destination)
await writeFile(join(destination, 'SHA256SUMS.txt'), hashes.join('\n') + '\n')
console.log(`Release prepared: ${destination}`)
