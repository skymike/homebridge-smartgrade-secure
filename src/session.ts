import { constants } from 'node:fs';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { CloudError, nonempty, object, parseSession } from './protocol.js';
import type { Bootstrap, Session } from './protocol.js';

const storageError = () => new CloudError('SESSION', 'Cannot access the private session/bootstrap file. Check its path, contents and owner permissions.');

async function regularFile(path: string, allowMissing = false): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw storageError();
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw storageError();
  }
}

async function readPrivate(path: string): Promise<unknown> {
  try {
    await regularFile(path);
    const handle = await open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 65_536) throw storageError();
      return JSON.parse(await handle.readFile('utf8'));
    } finally { await handle.close(); }
  } catch { throw storageError(); }
}

async function writePrivate(path: string, value: unknown): Promise<void> {
  const target = resolve(path);
  const temp = `${target}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const parent = await lstat(dirname(target));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw storageError();
    await regularFile(target, true);
    const handle = await open(temp, 'wx', 0o600);
    created = true;
    try { await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await regularFile(target, true);
    await rename(temp, target);
    created = false;
  } catch { throw storageError(); }
  finally { if (created) await unlink(temp).catch(() => {}); }
}

export async function loadSession(path: string): Promise<Session> {
  try { return parseSession(await readPrivate(path)); } catch { throw storageError(); }
}

export async function saveSession(path: string, session: Session): Promise<void> {
  await writePrivate(path, parseSession(session));
}

export async function loadBootstrap(path: string): Promise<Bootstrap> {
  const row = object(await readPrivate(path));
  return { username: nonempty(row.username), password: nonempty(row.password) };
}

export async function extractBootstrap(source: string, output: string): Promise<void> {
  // Reads the user's local JADX output. Never executes Java or prints its values.
  const content = await readFile(source, 'utf8');
  const field = (name: string) => {
    const match = content.match(new RegExp(`\\b${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*;`));
    if (!match?.[1]) throw new CloudError('INPUT', 'Expected SmartGrade BuildConfig fields were not found.');
    try { return nonempty(JSON.parse(match[1])); } catch { throw new CloudError('INPUT', 'Invalid BuildConfig string field.'); }
  };
  if (field('APPLICATION_ID') !== 'il.co.dealor') throw new CloudError('INPUT', 'This is not the SmartGrade Secure BuildConfig.');
  await writePrivate(output, { username: field('APP_USER_NAME'), password: field('APP_USER_PASSWORD') });
}
