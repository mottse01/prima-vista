import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'src', 'data', 'style-packs');
const output = join(root, 'src', 'data', 'stylePacks.generated.js');
const files = (await readdir(sourceDir)).filter((name) => name.endsWith('.json')).sort();
const packs = [];

for (const file of files) {
  const value = JSON.parse(await readFile(join(sourceDir, file), 'utf8'));
  packs.push(value);
}

const banner = `// Generated from ${relative(root, sourceDir)}. Edit JSON packs, not this file.\n`;
await writeFile(output, `${banner}export default ${JSON.stringify(packs, null, 2)};\n`);
