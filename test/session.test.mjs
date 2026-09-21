import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, lstat, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSession, saveSession, extractBootstrap, loadBootstrap } from '../dist/session.js';
import { session } from './helpers.mjs';
async function folder(t){ const path=await mkdtemp(join(tmpdir(),'smartgrade-test-'));t.after(()=>rm(path,{recursive:true,force:true}));return path; }
test('session round trip writes only necessary fields in an atomic private file',async t=>{
  const dir=await folder(t),path=join(dir,'session.json');
  await saveSession(path,{...session(),code:'do-not-save',phone:'do-not-save'});
  assert.deepEqual(await loadSession(path),session());
  assert.equal((await readFile(path,'utf8')).includes('do-not-save'),false);
  assert.deepEqual(await readdir(dir),['session.json']);
  if(process.platform!=='win32') assert.equal((await lstat(path)).mode & 0o777,0o600);
});
test('missing, oversized, malformed and symlink sessions are rejected without echoing content',async t=>{
  const dir=await folder(t),path=join(dir,'session.json');
  await assert.rejects(loadSession(path),error=>error.code==='SESSION');
  for(const data of ['sensitive-not-json','x'.repeat(70000),JSON.stringify({...session(),userId:''})]) {
    await writeFile(path,data); await assert.rejects(loadSession(path),error=>!error.message.includes('sensitive'));
  }
  if(process.platform!=='win32') {
    const link=join(dir,'link.json');await symlink(path,link);
    await assert.rejects(loadSession(link));await assert.rejects(saveSession(link,session()));
  }
});
test('failed replacement leaves existing target intact and cleans temporary file',async t=>{
  const dir=await folder(t),path=join(dir,'session.json');
  await mkdir(path); await writeFile(join(path,'sentinel'),'keep');
  await assert.rejects(saveSession(path,session()));
  assert.equal(await readFile(join(path,'sentinel'),'utf8'),'keep');
  assert.deepEqual(await readdir(dir),['session.json']);
});
test('bootstrap extraction reads only known BuildConfig fields without evaluating Java',async t=>{
  const dir=await folder(t),source=join(dir,'BuildConfig.java'),out=join(dir,'bootstrap.json');
  await writeFile(source,'public static final String APPLICATION_ID = "il.co.dealor";\npublic static final String APP_USER_NAME = "test-user";\npublic static final String APP_USER_PASSWORD = "test-pass";');
  await extractBootstrap(source,out);
  assert.deepEqual(await loadBootstrap(out),{username:'test-user',password:'test-pass'});
  await writeFile(source,'public static final String APP_USER_NAME = doSomething();');
  await assert.rejects(extractBootstrap(source,out));
  assert.deepEqual(await loadBootstrap(out),{username:'test-user',password:'test-pass'});
});
