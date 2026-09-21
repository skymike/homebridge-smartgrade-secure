import { test } from 'node:test';
import assert from 'node:assert/strict';
const { HomebridgeAPI } = await import(new URL('./api.js', import.meta.resolve(process.env.SMARTGRADE_TEST_HB || 'homebridge')).href);
import { WaterHeaterAccessory } from '../dist/accessory.js';
import { parseDevice } from '../dist/protocol.js';
import { rawDevice, deferred } from './helpers.mjs';
const device = parseDevice(rawDevice);
function make(client, options={}) {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Boiler',api.hap.uuid.generate('fixture'));
  const instance = new WaterHeaterAccessory(api,accessory,device,()=>client,{staleMs:1000,...options});
  return {instance,accessory,api};
}
test('fresh cloud booleans are available but null/offline/uninitialized state is not fabricated',async()=>{
  for (const state of [{...device,on:null},{...device,online:false}]) {
    const {instance}=make({getDevice:async()=>state});instance.apply(state);
    await assert.rejects(instance.getOn(),error=>error.hapStatus===-70402);
  }
  const {instance}=make({getDevice:async()=>{throw Error('offline');}});
  await assert.rejects(instance.getOn());
  instance.apply(device);assert.equal(await instance.getOn(),false);
});
test('stale reads refresh through the cloud and failures invalidate last known state',async()=>{
  const {instance}=make({getDevice:async()=>{throw Error('private token');}},{staleMs:-1});
  instance.apply({...device,on:true});await assert.rejects(instance.getOn());
});
test('power setter sends one write, preserves cloud state, and requires matching readback',async()=>{
  const writes=[];let on=false;
  const {instance}=make({getDevice:async()=>({...device,on}),setPower:async(id,value)=>{writes.push([id,value]);on=value;return {...device,on};}});
  instance.apply(device);await instance.setOn(true);
  assert.deepEqual(writes,[['heater-1',true]]);assert.equal(await instance.getOn(),true);
});
test('uncertain or contradicted power write reports failure without a repeat',async()=>{
  for (const throws of [true,false]) {
    let writes=0;const {instance}=make({getDevice:async()=>device,setPower:async()=>{writes++;if(throws)throw Error('timeout');return {...device,on:true};}},{confirmationDelayMs:0});
    instance.apply(device);await assert.rejects(instance.setOn(true));assert.equal(writes,1);
    assert.equal(await instance.getOn(),false);
  }
});
test('old reads cannot overwrite a newer completed command',async()=>{
  const old=deferred();let reads=0,on=false;
  const {instance}=make({getDevice:async()=>++reads===1?old.promise:{...device,on},setPower:async(_id,value)=>{on=value;return {...device,on};}});
  instance.apply(device);
  const refresh=instance.refresh();await new Promise(resolve=>setImmediate(resolve));
  await instance.setOn(true);old.resolve(device);await refresh;
  assert.equal(await instance.getOn(),true);
});
test('alternating commands serialize and do not overlap',async()=>{
  let active=0,max=0,on=false;const writes=[];
  const {instance}=make({getDevice:async()=>({...device,on}),setPower:async(_id,value)=>{
    active++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));on=value;writes.push(value);active--;return {...device,on};
  }});
  instance.apply(device);await Promise.all([instance.setOn(true),instance.setOn(false)]);
  assert.deepEqual(writes,[true,false]);assert.equal(max,1);assert.equal(await instance.getOn(),false);
});
test('unsupported replacement device, invalid input, shutdown cannot cause power writes',async()=>{
  let writes=0;const {instance}=make({getDevice:async()=>({...device,productId:2}),setPower:async()=>{writes++;return device;}});
  await assert.rejects(instance.setOn('true'));await assert.rejects(instance.setOn(true));
  instance.stop();await assert.rejects(instance.setOn(false));assert.equal(writes,0);
});
