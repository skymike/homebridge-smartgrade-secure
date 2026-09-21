import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDevice, CloudError } from '../dist/protocol.js';
import { rawDevice } from './helpers.mjs';

test('device parser preserves boolean, offline, missing and null state', () => {
  for (const value of [true, false, null, undefined]) {
    const result = parseDevice({ ...rawDevice, switch_1: value, is_online: false });
    assert.equal(result.on, value ?? null);
    assert.equal(result.online, false);
    assert.equal(result.siteId, 'site-1');
  }
});
test('malformed states and identifiers cannot be turned into controllable devices', () => {
  for (const patch of [{switch_1:'false'}, {is_online:'true'}, {id:''}, {product_id:'6'}, {site_id:null}]) {
    assert.throws(() => parseDevice({ ...rawDevice, ...patch }), CloudError);
  }
});

test('boiler product types 6 and 7 are supported, sockets are excluded', async () => {
  const {supported,identifier}=await import('../dist/protocol.js');
  assert.equal(supported({...parseDevice(rawDevice),productId:7}),true);
  assert.equal(supported(parseDevice(rawDevice)),true);
  assert.equal(supported({...parseDevice(rawDevice),productId:2}),false);
  for(const id of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,true,null]) assert.throws(()=>identifier(id),CloudError);
});
