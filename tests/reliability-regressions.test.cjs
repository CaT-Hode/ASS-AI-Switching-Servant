const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {Store}=require('../core/store.cjs'),{apiIdentity}=require('../core/native-api-identity.cjs');
const {normalizeProvider,parseImport,codexModelId}=require('../core/models.cjs');
const {exportConfig}=require('../core/config-export.cjs'),{ModelDirectory}=require('../core/model-directory.cjs'),{Router}=require('../core/router.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ass-reliability-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let encrypted=true;const store=new Store(path.join(root,'data'),path.join(root,'codex'),{isEncryptionAvailable:()=>encrypted,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()});
 return {store,setEncryption:v=>encrypted=v};}
const provider=(id='p',extra={})=>({id,name:'Test',baseUrl:'https://example.test/v1',apiKey:'fake-key',models:[{model:'m'}],...extra});
function deletion(store){const source=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');let handler;
 vm.runInNewContext(source.slice(source.indexOf('register("delete-provider"'),source.indexOf('register("save-model"')),{register:(_,fn)=>handler=fn,dialog:{showMessageBox:async()=>({response:1})},window:{},store,apiIdentity,invalidateReports:()=>{}});return handler;}
test('provider deletion: encryption failure rolls back all state; unrelated save and repeated delete are safe',async t=>{
 const f=fixture(t);for(const id of ['native_api_01234567890123456789','other'])f.store.updateProvider(provider(id));
 f.store.state.nativeApiExclusions=['keep'];f.store.state.nativeSupplierExclusions=['keep'];f.store.save();
 const state=structuredClone(f.store.state),disk=fs.readFileSync(f.store.file);f.setEncryption(false);
 await assert.rejects(deletion(f.store)('native_api_01234567890123456789'),/加密/);assert.deepEqual(f.store.state,state);assert.deepEqual(fs.readFileSync(f.store.file),disk);
 f.setEncryption(true);f.store.updateProvider(provider('other',{name:'Edited'}));assert.equal(f.store.state.providers.length,2);
 await deletion(f.store)('native_api_01234567890123456789');const once=structuredClone(f.store.state);await deletion(f.store)('native_api_01234567890123456789');assert.deepEqual(f.store.state,once);assert.deepEqual(f.store.state.nativeSupplierExclusions,['keep','native_api_01234567890123456789']);
});
test('provider deletion: catalog write failure also rolls back exclusions and providers',async t=>{
 const f=fixture(t);f.store.updateProvider(provider());const state=structuredClone(f.store.state),write=f.store.writeCatalog;
 f.store.writeCatalog=()=>{throw Error('Synthetic catalog failure');};await assert.rejects(deletion(f.store)('p'),/catalog/);assert.deepEqual(f.store.state,state);
 f.store.writeCatalog=write;f.store.updateProvider(provider('other'));assert.equal(f.store.state.providers.length,2);
});
test('directory: imported native-prefixed provider wins; exact native client, missing and repeat stay distinct',async()=>{
 const p=parseImport({providers:[provider('native-codex') ]})[0];let native=0,calls=0;
 const d=new ModelDirectory({getProvider:id=>id===p.id?p:null,readOfficial:()=>({models:[]}),readNative:async()=>{native++;return {models:[{model:'native'}]};},fetchUpstream:async()=>{calls++;return Response.json({data:[{id:'api'}]});}});
 assert.equal((await d.read(p.id)).models[0].model,'api');await d.read(p.id);assert.equal(calls,1);assert.equal(native,0);
 assert.equal((await d.read('native-pi')).models[0].model,'native');await assert.rejects(d.read('native-unknown'),/不存在/);
});
test('configuration counts: creation, merge and export share finite provider cap; exact cap round-trips',t=>{
 const f=fixture(t),items=Array.from({length:100},(_,i)=>provider('p'+i));f.store.import({providers:items});
 const output=exportConfig(f.store.state.providers,{includeSecrets:true,acknowledged:true});assert.equal(parseImport(JSON.parse(JSON.stringify(output,null,2))).length,100);
 const before=structuredClone(f.store.state);assert.throws(()=>f.store.updateProvider(provider('extra')),/100|上限|数量/);assert.deepEqual(f.store.state,before);
 assert.throws(()=>f.store.import({providers:[provider('extra')]}),/100|上限|数量/);assert.deepEqual(f.store.state,before);
 assert.throws(()=>exportConfig([...output.providers,provider('extra')]),/100|上限|数量/);
 f.store.import(output);assert.equal(f.store.state.providers.length,100);
});
test('configuration size: creation and export reject oversized portable data; allowed secret export imports repeatedly',t=>{
 const f=fixture(t),large=provider('big',{apiKey:'a'.repeat(6*1024*1024)});
 assert.throws(()=>f.store.updateProvider(large),/MiB|大小|上限/);assert.equal(f.store.state.providers.length,0);
 assert.throws(()=>exportConfig([large],{includeSecrets:true,acknowledged:true}),/MiB|大小|上限/);
 f.store.updateProvider(provider('ok',{apiKey:'中'.repeat(1000)}));const output=exportConfig(f.store.state.providers,{includeSecrets:true,acknowledged:true});
 f.store.import(output);f.store.import(output);assert.equal(f.store.state.providers.length,1);
 assert.throws(()=>parseImport({providers:[large]}),/MiB|大小|上限/);
});
test('configuration model cap: create, edit, import, export reject 10001 without changing saved state',t=>{
 const f=fixture(t),models=Array.from({length:10000},(_,i)=>({model:'m'+i}));f.store.updateProvider(provider('p',{models}));
 const portable=exportConfig(f.store.state.providers);assert.equal(parseImport(portable)[0].models.length,10000);
 assert.throws(()=>f.store.model('p',{model:'extra'}),/10000|上限|数量/);assert.equal(f.store.state.providers[0].models.length,10000);
 assert.throws(()=>normalizeProvider(provider('p',{models:[...models,{model:'extra'}]})),/10000|上限|数量/);
});
for(const harness of [false,true])for(const streaming of [false,true])test(`request logs distinguish HTTP 200 task failure (${harness?'native':'Codex'}, ${streaming?'SSE':'JSON'})`,async t=>{
 let status='failed',httpStatus=200;const logs=[],p=normalizeProvider(provider());
 const router=new Router({getState:()=>({providers:[p]}),log:r=>logs.push(r),fetchUpstream:async()=>streaming?new Response(`data: ${JSON.stringify({type:'response.completed',response:{status}})}\n\n`,{status:httpStatus,headers:{'content-type':'text/event-stream'}}):Response.json({status},{status:httpStatus})});
 await router.start(0);t.after(()=>router.stop());
 async function request(){const r=await fetch(`http://127.0.0.1:${router.port}/clients/${harness?'pi/harness/p':'ASS'}/v1/responses`,{method:'POST',headers:{authorization:'Bearer '+router.clientToken},body:JSON.stringify({model:harness?'m':codexModelId('p','m'),stream:streaming}),signal:AbortSignal.timeout(3000)});await r.text();return logs.at(-1);}
 for(let i=0;i<2;i++){const log=await request();assert.equal(log.ok,false);assert.equal(log.httpStatus,200);assert.equal(log.httpOk,true);}
 status='completed';const log=await request();assert.equal(log.ok,true);assert.equal(log.httpStatus,200);assert.equal(log.httpOk,true);
 httpStatus=503;const unavailable=await request();assert.equal(unavailable.ok,false);assert.equal(unavailable.httpStatus,503);assert.equal(unavailable.httpOk,false);
});
