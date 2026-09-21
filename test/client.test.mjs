import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { SmartGradeClient } from '../dist/client.js';
import { CloudError } from '../dist/protocol.js';
import { rawDevice, session, json } from './helpers.mjs';

test('real HTTP transport emits exact desired-state payload, token headers and encoded path', async t => {
  const received = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    received.push({url:req.url,method:req.method,headers:req.headers,body});
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({...rawDevice,id:'heater /1'}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const client = new SmartGradeClient({ session:session(), fetch: (url, options) => {
    assert.equal(new URL(url).origin, 'https://api.iotechv.com');
    assert.equal(options.redirect, 'error');
    return fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, options);
  }});
  await client.setPower('heater /1', false);
  assert.equal(received.length, 1);
  assert.equal(received[0].url, '/api/v1/devices/heater%20%2F1/toggle_switches');
  assert.equal(received[0].method, 'POST');
  assert.deepEqual(JSON.parse(received[0].body), {switch_1:false});
  assert.equal(received[0].headers.authorization, 'Bearer fixture-user');
  assert.equal(received[0].headers['x-app-token'], 'Bearer fixture-app');
});
test('uncertain writes are never retried and transport details are redacted', async () => {
  let calls = 0;
  const client = new SmartGradeClient({session:session(),fetch:async()=>{ calls++; throw Error('fixture-user secret body'); }});
  await assert.rejects(client.setPower('heater-1',true), error => error instanceof CloudError && !error.message.includes('fixture-user'));
  assert.equal(calls,1);
});
test('HTTP error responses cannot leak body secrets', async () => {
  for (const status of [401,403,429,500]) {
    const client = new SmartGradeClient({session:session(),fetch:async()=>json({secret:'fixture-user'}, status)});
    await assert.rejects(client.getProfile(), error => error instanceof CloudError && error.status === status && !error.message.includes('fixture-user'));
  }
});
test('discovery follows profile/sites/devices shape and deduplicates shared devices', async () => {
  const routes=[];
  const client = new SmartGradeClient({session:session(),fetch:async url => {
    routes.push(new URL(url).pathname + new URL(url).search);
    if (url.endsWith('/profile')) return json({id:'user-1'});
    if (url.includes('/users/user-1/sites')) return json({sites:[{id:'site-1'},{id:'site-1'}]});
    return json([rawDevice]);
  }});
  const devices = await client.listDevices();
  assert.equal(devices.length,1);
  assert.equal(devices[0].id,'heater-1');
  assert.ok(routes.includes('/api/v1/users/user-1/sites?shared=true'));
});
test('identity mismatches, malformed collections and invalid JSON fail closed', async () => {
  const client = new SmartGradeClient({session:session(),fetch:async()=>json({device:{...rawDevice,id:'other'}})});
  await assert.rejects(client.getDevice('site-1','heater-1'),CloudError);
  const invalid = new SmartGradeClient({session:session(),fetch:async()=>new Response('not json')});
  await assert.rejects(invalid.getProfile(),CloudError);
  const wrongUser = new SmartGradeClient({session:session(),fetch:async()=>json({id:'other'})});
  await assert.rejects(wrongUser.getProfile(),CloudError);
  const badSites = new SmartGradeClient({session:session(),fetch:async url=>json(url.endsWith('/profile')?{id:'user-1'}:{sites:{}})});
  await assert.rejects(badSites.listDevices(),CloudError);
});
test('request deadline and client shutdown abort network operations', async () => {
  const client = new SmartGradeClient({session:session(),timeoutMs:15,fetch:async (_url,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))))});
  const keepAlive = setTimeout(()=>{},1000);
  try { await assert.rejects(client.getProfile(),CloudError); } finally { clearTimeout(keepAlive); }
  client.close();
  await assert.rejects(client.getProfile(),CloudError);
});

test('unsupported single-device GET falls back to site list and validates identity', async()=>{
 const routes=[];
 const client=new SmartGradeClient({session:session(),fetch:async url=>{
  routes.push(url);
  return url.endsWith('/devices/heater-1')?json({},405):json([rawDevice]);
 }});
 assert.equal((await client.getDevice('site-1','heater-1')).id,'heater-1');
 assert.equal(routes.length,2);
 await assert.rejects(client.getDevice('wrong-site','heater-1'),CloudError);
});
