import { test } from 'node:test';
import assert from 'node:assert/strict';
const { HomebridgeAPI } = await import(new URL('./api.js', import.meta.resolve(process.env.SMARTGRADE_TEST_HB || 'homebridge')).href);
import { SmartGradePlatform } from '../dist/platform.js';
import { parseDevice } from '../dist/protocol.js';
import { rawDevice, deferred } from './helpers.mjs';
import { resolve } from 'node:path';
function harness(client, config={}) {
  const api=new HomebridgeAPI(),registered=[],updated=[],removed=[];
  api.on('registerPlatformAccessories',items=>registered.push(...items));
  api.on('updatePlatformAccessories',items=>updated.push(...items));
  api.on('unregisterPlatformAccessories',items=>removed.push(...items));
  const messages=[];const log=Object.assign(message=>messages.push(message),{info:message=>messages.push(message),warn:message=>messages.push(message),error:message=>messages.push(message),debug:()=>{}});
  const platform=new SmartGradePlatform(log,{platform:'SmartGradeSecure',sessionFile:resolve('fixture-session'),...config},api,async()=>client);
  return {api,registered,updated,removed,messages,platform};
}
const device=parseDevice(rawDevice);
test('discovery registers a stable supported accessory once and keeps credentials out of cache',async t=>{
  const h=harness({listDevices:async()=>[device,{...device,id:'socket',productId:2}],close:()=>{}});
  t.after(()=>h.platform.stop());
  await h.platform.discoverDevices();await h.platform.discoverDevices();
  assert.equal(h.registered.length,1);assert.equal(h.removed.length,0);
  const accessory=h.registered[0];
  assert.equal(accessory._associatedPlugin,'homebridge-smartgrade-secure');
  assert.equal(accessory.getService(h.api.hap.Service.Switch).getCharacteristic(h.api.hap.Characteristic.On).value,false);
  assert.deepEqual(Object.keys(accessory.context),['device']);
});
test('cached accessory is restored without new registration and failed discovery preserves it',async t=>{
  let fail=false;
  const client={listDevices:async()=>{if(fail)throw Error('secret');return [device];},close:()=>{}};
  const first=harness(client);t.after(()=>first.platform.stop());await first.platform.discoverDevices();
  const second=harness(client);t.after(()=>second.platform.stop());
  second.platform.configureAccessory(first.registered[0]);await second.platform.discoverDevices();
  assert.equal(second.registered.length,0);fail=true;
  await assert.rejects(second.platform.discoverDevices());
  assert.equal(second.removed.length,0);
  await assert.rejects(first.registered[0].getService(second.api.hap.Service.Switch).getCharacteristic(second.api.hap.Characteristic.On).handleGetRequest());
});
test('configuration filtering never exposes unsupported devices and invalid intervals fail closed',async t=>{
  let calls=0;const client={listDevices:async()=>{calls++;return [device];},close:()=>{}};
  const filtered=harness(client,{includeDeviceIds:['another']});t.after(()=>filtered.platform.stop());
  await filtered.platform.discoverDevices();assert.equal(filtered.registered.length,0);
  const invalid=harness(client,{pollInterval:0});t.after(()=>invalid.platform.stop());
  await assert.rejects(invalid.platform.discoverDevices());assert.equal(calls,1);
});
test('overlapping discovery shares one request and shutdown prevents late registration',async()=>{
  const gate=deferred();let calls=0,closed=0;
  const h=harness({listDevices:async()=>{calls++;return gate.promise;},close:()=>{closed++;}});
  const a=h.platform.discoverDevices(),b=h.platform.discoverDevices();
  await new Promise(resolve=>setImmediate(resolve));h.platform.stop();gate.resolve([device]);
  await Promise.all([a,b]);assert.equal(calls,1);assert.equal(closed,1);assert.equal(h.registered.length,0);
});
test('discovery started during a write cannot overwrite its confirmed result',async t=>{
  const post=deferred(),listing=deferred();let on=false,holdList=false;
  const h=harness({listDevices:async()=>holdList?listing.promise:[device],getDevice:async()=>({...device,on}),setPower:async()=>{await post.promise;on=true;return {...device,on};},close:()=>{}});
  t.after(()=>h.platform.stop());await h.platform.discoverDevices();
  const characteristic=h.registered[0].getService(h.api.hap.Service.Switch).getCharacteristic(h.api.hap.Characteristic.On);
  const write=characteristic.handleSetRequest(true);await new Promise(resolve=>setImmediate(resolve));
  holdList=true;const refresh=h.platform.discoverDevices();await new Promise(resolve=>setImmediate(resolve));
  post.resolve();await write;assert.equal(await characteristic.handleGetRequest(),true);
  listing.resolve([device]);await refresh;assert.equal(await characteristic.handleGetRequest(),true);
});
test('moving a heater to another site keeps its UUID but uses the new site for reads',async t=>{
  let current=device;const paths=[];
  const h=harness({listDevices:async()=>[current],getDevice:async site=>{paths.push(site);return {...current,on:true};},setPower:async()=>current,close:()=>{}});
  t.after(()=>h.platform.stop());await h.platform.discoverDevices();
  const accessory=h.registered[0];current={...device,siteId:'site-new',on:null};await h.platform.discoverDevices();
  assert.equal(await accessory.getService(h.api.hap.Service.Switch).getCharacteristic(h.api.hap.Characteristic.On).handleGetRequest(),true);
  assert.equal(paths.at(-1),'site-new');assert.equal(h.registered.length,1);
});
test('a stopped old-site setter cannot complete and overwrite a rebound characteristic',async t=>{
  const confirmation=deferred();let current=device,reads=0;
  const h=harness({listDevices:async()=>[current],getDevice:async()=>++reads===1?device:confirmation.promise,setPower:async()=>({...device,on:true}),close:()=>{}});
  t.after(()=>h.platform.stop());await h.platform.discoverDevices();
  const characteristic=h.registered[0].getService(h.api.hap.Service.Switch).getCharacteristic(h.api.hap.Characteristic.On);
  const pending=characteristic.handleSetRequest(true);
  const rejected=assert.rejects(pending);
  await new Promise(resolve=>setImmediate(resolve));
  current={...device,siteId:'site-new',on:false};await h.platform.discoverDevices();
  confirmation.resolve({...device,on:true});await rejected;
  assert.equal(await characteristic.handleGetRequest(),false);
});

test('explicit exclusions remove cached accessories even when cloud is unavailable',async t=>{
 const first=harness({listDevices:async()=>[device],close:()=>{}}); t.after(()=>first.platform.stop());
 await first.platform.discoverDevices();
 const next=harness({listDevices:async()=>{throw Error('offline');},close:()=>{}},{excludeDeviceIds:[device.id]});t.after(()=>next.platform.stop());
 next.platform.configureAccessory(first.registered[0]);
 await assert.rejects(next.platform.discoverDevices());
 assert.equal(next.removed.length,1);
});
