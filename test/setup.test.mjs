import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { secretPrompt } from '../dist/prompt.js';

test('verification input is never echoed and raw mode is restored',async()=>{
  const input=new PassThrough(),output=new PassThrough();
  input.isTTY=true; let raw=false;input.setRawMode=value=>{raw=value;};
  let shown='';output.on('data',chunk=>{shown+=chunk;});
  const answer=secretPrompt('Verification code: ',input,output);
  input.emit('keypress','1',{name:'1'});input.emit('keypress','2',{name:'2'});
  input.emit('keypress','3',{name:'3'});input.emit('keypress','',{name:'return'});
  assert.equal(await answer,'123'); assert.equal(shown.includes('123'),false); assert.equal(raw,false);
});
test('cancel and noninteractive input cannot leave a prompt hanging',async()=>{
  const input=new PassThrough(),output=new PassThrough();input.isTTY=true;
  let raw=false; input.setRawMode=value=>{raw=value;};
  const answer=secretPrompt('Code: ',input,output);
  input.emit('keypress','c',{name:'c',ctrl:true});
  await assert.rejects(answer);assert.equal(raw,false);
  await assert.rejects(secretPrompt('Code: ',new PassThrough(),output));
});
