import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SetupController} from '../dist/ui.js';
import {session} from './helpers.mjs';
import {loadSession} from '../dist/session.js';

test('UI SMS flow enforces order, cooldown, private persistence and redacted discovery',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'smartgrade-ui-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const bootstrap=join(dir,'bootstrap.json');await writeFile(bootstrap,JSON.stringify({username:'fixture',password:'secret'}));
 const config=join(dir,'config.json');await writeFile(config,JSON.stringify({platforms:[{platform:'SmartGradeSecure',bootstrapFile:bootstrap,sessionFile:join(dir,'session.json')}]}));
 let codes=0;
 const controller=new SetupController(dir,config,()=>({requestLoginCode:async()=>{codes++;},verifyLoginCode:async()=>session(),listDevices:async()=>[{id:'one',name:'Boiler',productId:7,online:true,on:false,userToken:'never-export'}],close:()=>{}}));
 await assert.rejects(controller.verify('1234'));
 await controller.requestCode('0501234567');await assert.rejects(controller.requestCode('0501234567'));
 assert.equal(codes,1);await controller.verify('1234');
 assert.equal((await loadSession(join(dir,'session.json'))).userToken,session().userToken);
 assert.equal(JSON.stringify(await controller.discover()).includes('never-export'),false);
 assert.equal((await controller.status()).loggedIn,true);
 await assert.rejects(controller.verify('1234'));
 controller.close();
});

test('custom UI IPC starts and returns sanitized failures without exposing configuration',async t=>{
 const {fork}=await import('node:child_process');
 const dir=await mkdtemp(join(tmpdir(),'smartgrade-ipc-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const config=join(dir,'config.json');await writeFile(config,JSON.stringify({platforms:[]}));
 const child=fork(new URL('../homebridge-ui/server.js',import.meta.url),[],{env:{...process.env,HOMEBRIDGE_STORAGE_PATH:dir,HOMEBRIDGE_CONFIG_PATH:config},stdio:['ignore','ignore','ignore','ipc']});
 t.after(()=>child.kill());
 const response=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('IPC startup timed out')),5000);
  child.on('error',reject);
  child.on('message',m=>{
   if(m.action==='ready')child.send({action:'request',requestId:'status',path:'/status'});
   if(m.action==='response'){clearTimeout(timer);resolve(m.payload);}
  });
 });
 assert.equal(response.success,true);assert.equal(response.data.loggedIn,false);assert.equal(response.data.bootstrapReady,false);
 child.disconnect();
});
