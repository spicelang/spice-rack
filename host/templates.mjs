import fs from 'node:fs/promises';
import path from 'node:path';

const EXTENSIONS = new Set(['.html', '.xml', '.svg']);

/** All template files below `dir`, as paths relative to it */
async function walk(dir, prefix = '') {
  const found = [];
  for (const entry of await fs.readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(dir, relative)));
    else if (EXTENSIONS.has(path.extname(entry.name))) found.push(relative);
  }
  return found.sort();
}

/**
 * Reads the template files and packs them into the format the wasm module expects: for each template
 * `name\x02length\x03source`, where the name is the path below `dir` without its extension ("partials/card") and the
 * length is the size of the source in bytes. The module reads the headers when it starts to render and compiles a
 * template when it first needs it, see src/template.spice.
 *
 * @returns {Promise<Buffer>} the blob
 */
export async function loadTemplates(dir) {
  const files = await walk(dir);
  if (files.length === 0) throw new Error(`no templates found in ${dir}`);
  const parts = [];
  for (const file of files) {
    const source = await fs.readFile(path.join(dir, file), 'utf8');
    if (source.includes('\0')) throw new Error(`template ${file} contains a control character (NUL)`);
    const name = file.slice(0, file.length - path.extname(file).length);
    const bytes = Buffer.from(source, 'utf8');
    parts.push(Buffer.from(`${name}\x02${bytes.length}\x03`, 'utf8'), bytes);
  }
  return Buffer.concat(parts);
}
