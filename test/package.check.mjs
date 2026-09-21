import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

const archive = process.argv[2];
assert.ok(archive, 'Pass the packed .tgz path');
const bytes = gunzipSync(await readFile(archive));
const entries = new Map();
for (let offset = 0; offset + 512 <= bytes.length;) {
  const header = bytes.subarray(offset, offset + 512);
  if (header.every(byte => byte === 0)) break;
  const name = header.subarray(0, 100).toString().split('\0')[0];
  const size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8);
  assert.ok(Number.isSafeInteger(size) && size >= 0);
  const type = header[156];
  if (type === 0 || type === 48) entries.set(name, bytes.subarray(offset + 512, offset + 512 + size));
  else assert.equal(type, 53, 'Only files and directories may be packaged');
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.ok(entries.size > 5);
for (const name of entries.keys()) {
  assert.match(name, /^package\/(dist\/[a-z-]+\.(?:js|d\.ts)|README\.md|package\.json|config\.schema\.json)$/);
}
const manifest = JSON.parse(entries.get('package/package.json').toString());
assert.equal(manifest.name, 'homebridge-smartgrade-secure');
assert.equal(manifest.private, true);
assert.ok(entries.has('package/dist/setup.js'));
assert.ok(entries.get('package/dist/setup.js').toString().startsWith('#!/usr/bin/env node'));
const dir = await mkdtemp(join(tmpdir(), 'smartgrade-package-'));
try {
  for (const [name, content] of entries) {
    const path = join(dir, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, content);
  }
  const register = createRequire(join(dir, 'load.cjs'))(join(dir, 'package', manifest.main));
  const calls = [];
  register({ registerPlatform: (...args) => calls.push(args) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'homebridge-smartgrade-secure');
  assert.equal(calls[0][1], 'SmartGradeSecure');
  assert.equal(typeof calls[0][2], 'function');
  console.log(`Package verified: ${entries.size} allowed files; isolated entrypoint registers the platform.`);
} finally { await rm(dir, { recursive: true, force: true }); }
