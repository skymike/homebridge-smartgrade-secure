import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SmartGradeClient } from '../dist/client.js';
import { session, json, deferred } from './helpers.mjs';
const jwt = exp => `e30.${Buffer.from(JSON.stringify({exp})).toString('base64url')}.fixture`;
const credentials={username:'test-app',password:'test-password'};

test('phone/code login uses only the app token and validates profile before saving', async () => {
  const requests=[], saved=[];
  const client = new SmartGradeClient({ credentials, saveSession:async value=>saved.push(value), fetch:async (url,opts)=>{
    requests.push({url, ...opts});
    if (url.endsWith('/apps/token')) return json({token:'new-app',exp:4102444800});
    if (url.endsWith('/customers')) return json({success:true,mobile:'0501234567'});
    if (url.endsWith('/login/code')) return json({jwt:jwt(4102444800),user:{id:'user-1'}});
    return json({id:'user-1'});
  }});
  await client.requestLoginCode('0501234567');
  const result=await client.verifyLoginCode('123456');
  assert.equal(result.userId,'user-1');
  assert.equal(requests[0].headers.Authorization,`Basic ${Buffer.from('test-app:test-password').toString('base64')}`);
  assert.deepEqual(JSON.parse(requests[1].body),{customer:{mobile:'0501234567'}});
  assert.deepEqual(JSON.parse(requests[2].body),{user:{code:'123456'}});
  assert.equal(requests[1].headers.Authorization,undefined);
  assert.equal(requests[2].headers['X-APP-TOKEN'],'Bearer new-app');
  assert.equal(saved.length,1);
  assert.equal(JSON.stringify(saved).includes('123456'),false);
});
test('bad code, missing login request, invalid JWT and identity mismatch never persist a session', async () => {
  for (const scenario of ['code','jwt','identity']) {
    const saved=[];
    const client=new SmartGradeClient({credentials,saveSession:async s=>saved.push(s),fetch:async url=>{
      if(url.endsWith('/apps/token')) return json({token:'app',exp:4102444800});
      if(url.endsWith('/customers')) return json({success:true});
      if(url.endsWith('/login/code')) return scenario==='code'?json({},401):json({jwt:scenario==='jwt'?'bad':jwt(4102444800),user:{id:'user-1'}});
      return json({id:'wrong-user'});
    }});
    await assert.rejects(client.verifyLoginCode('123456'));
    await client.requestLoginCode('0501234567');
    await assert.rejects(client.verifyLoginCode('123456'));
    assert.equal(saved.length,0);
  }
});
test('concurrent requests refresh the expiring app token once and persist renewal', async()=>{
  let stored={...session(),appExpiresAt:1};
  const gate=deferred(); let renewals=0;
  const client=new SmartGradeClient({loadSession:async()=>stored,saveSession:async s=>{stored=s;},credentials,fetch:async(url,opts)=>{
    if(url.endsWith('/apps/token')) {renewals++; await gate.promise; return json({token:'renewed',exp:4102444800});}
    assert.equal(opts.headers['X-APP-TOKEN'],'Bearer renewed'); return json({id:'user-1'});
  }});
  const a=client.getProfile(),b=client.getProfile();
  await new Promise(resolve=>setImmediate(resolve)); gate.resolve();
  await Promise.all([a,b]);
  assert.equal(renewals,1); assert.equal(stored.appToken,'renewed');
});
test('expired sessions and revoked tokens stop background requests without sending codes', async()=>{
  let calls=0;
  const expired=new SmartGradeClient({session:{...session(),userExpiresAt:1},fetch:async()=>{calls++;return json({});}});
  await assert.rejects(expired.getProfile(),error=>error.code==='AUTH'); assert.equal(calls,0);
  const revoked=new SmartGradeClient({session:session(),fetch:async()=>{calls++;return json({},401);}});
  await assert.rejects(revoked.getProfile()); await assert.rejects(revoked.getProfile());
  assert.equal(calls,1);
});
test('replacing the stored user session resumes access after a revoked token', async()=>{
  let stored=session(), calls=0;
  const client=new SmartGradeClient({loadSession:async()=>stored,fetch:async()=>++calls===1?json({},401):json({id:'user-1'})});
  await assert.rejects(client.getProfile());
  stored={...stored,userToken:'replacement'};
  assert.deepEqual(await client.getProfile(),{id:'user-1'});
});
