// Checks the templates without a database: they must compile, only include templates that exist, and none of them may
// be left over (every template is used by the Spice code or by another template).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRuntime } from '../runtime.mjs';
import { loadTemplates } from '../templates.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const templatesDir = path.join(root, 'templates');

async function files(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(full)));
    else found.push(full);
  }
  return found;
}

describe('templates', () => {
  it('compile and only include existing templates', async () => {
    const runtime = await loadRuntime(path.join(root, 'build', 'rack.wasm'), await loadTemplates(templatesDir));
    assert.equal(runtime.templateErrors(), '');
  });

  it('are all used', async () => {
    const names = (await files(templatesDir)).map((file) => path.relative(templatesDir, file).replace(/\.[a-z]+$/, ''));
    const sources = [];
    for (const file of [...(await files(path.join(root, 'src'))), ...(await files(templatesDir))]) {
      sources.push(await fs.readFile(file, 'utf8'));
    }
    const code = sources.join('\n');
    // layout is rendered by renderPage; the pages and tab templates are named in the Spice code
    const unused = names.filter((name) => name !== 'layout' && !code.includes(`"${name}"`));
    assert.deepEqual(unused, []);
  });

  it('are rejected by the loader if they contain NUL', async () => {
    const dir = await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'rack-tpl-'));
    try {
      await fs.writeFile(path.join(dir, 'bad.html'), 'a\0b');
      await assert.rejects(loadTemplates(dir), /control character/);
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });
});
