const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {readDshModelMetadata}=require('../core/dsh-model-catalog.cjs');
const {modelSources}=require('../core/model-inventory.cjs');
const dsh=require('../core/dsh-config.cjs');
async function fixture(t,layout='dsh-app',profile='custom') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ass-dsh-catalog-')),dir=path.join(root,'.dsh');
  const write=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof data==='string'?data:JSON.stringify(data));};
  const client={id:'dsh',name:'DSH',accounts:[{id:'deep',provider:'DEEPSEEK_API_KEY',nativeDir:dir},
    {id:'other',provider:'custom-api',nativeDir:dir}]};
  const state={groups:[{id:'deepseek',models:[{id:'actual-a',name:'First',reasoning:{efforts:[{id:'low'},{id:'max'}],defaultEffort:'max'}},{id:'actual-b'}]},
    {id:'custom-api',models:[{id:'custom-only'}]},{id:'unrelated',models:[{id:'never-attribute'}]}],failures:[]};
  const calls=[];
  const server=http.createServer(async(req,res)=>{
    calls.push(req.url);
    if(req.method==='GET'){assert.equal(new URL(req.url,'http://localhost').searchParams.get('token'),'synthetic-token');
      res.writeHead(302,{'set-cookie':'dsh-session=synthetic-cookie; HttpOnly','location':'/'});res.end();return;}
    assert.equal(req.url,'/api/session/modelCatalog');assert.equal(req.headers.cookie,'dsh-session=synthetic-cookie');
    let text='';for await(const chunk of req)text+=chunk;
    const request=JSON.parse(text);assert.equal(request.method,'session/modelCatalog');assert.deepEqual(request.payload,{args:{}});
    state.onRequest?.();res.writeHead(state.status||200,{'content-type':'application/json'});
    res.end(state.badJson?'invalid':JSON.stringify({rpcId:state.badId?'wrong':request.rpcId,result:{ok:true,value:{groups:state.groups,failures:state.failures}}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`,file=path.join(dir,layout==='root'?'web.json':layout+'/web.json');
  const descriptor={schemaVersion:1,profile,coreVersion:'0.2.0-rc.2',origin,url:origin+'/?token=synthetic-token',ownerId:'fake-owner'};
  write(file,descriptor);write(path.join(dir,'profiles',profile,'cordis.patch.yml'),'- id: agent-default-model\n  config: {}\n');
  return {root,dir,write,client,state,calls,file,descriptor};
}
for(const layout of ['dsh-app','desktop-link','root'])test(`DSH ${layout} reads actual picker models for current custom profile without remote defaults`,async t=>{
  const f=await fixture(t,layout);assert.equal(dsh.target(f.dir).profile,'custom');
  const settings=path.join(f.dir,'profiles','web','cordis.patch.yml');
  f.write(settings,'- id: llm-deepseek\n  config:\n    models:\n      - id: wrong-profile\n');
  for(let repeat=0;repeat<2;repeat++){
    const report=await readDshModelMetadata(f.client);assert.equal(report.error,undefined);
    assert.deepEqual(report.accounts.deep.models.map(m=>m.model),['actual-a','actual-b']);
    assert.deepEqual(report.accounts.other.models.map(m=>m.model),['custom-only']);
    assert.equal(report.accounts.deep.models[0].defaultEffort,'max');
    assert.equal(report.accounts.deep.models[0].catalogSource,'DSH 运行时目录 · custom');
    assert.doesNotMatch(JSON.stringify(report),/synthetic-token|synthetic-cookie|never-attribute|wrong-profile|deepseek-v4-flash/);
    const rows=modelSources({officialModels:[],providers:[]},{clients:[f.client]},{directories:{'native-dsh':report}}).find(p=>p.id==='native-dsh').models;
    assert.equal(rows.length,3);
  }
  assert.equal(f.calls.length,4,'one local request pair per home, not per account');
});
test('DSH empty runtime groups override explicit models; next refresh reflects model additions/removals',async t=>{
  const f=await fixture(t);f.write(path.join(f.dir,'profiles','custom','cordis.patch.yml'),'- id: llm-deepseek\n  config:\n    models:\n      - id: explicit-only\n');
  f.state.groups=[];let report=await readDshModelMetadata(f.client);assert.deepEqual(report.models,[]);assert.equal(report.error,undefined);
  f.state.groups=[{id:'deepseek',models:[{id:'new'}]}];report=await readDshModelMetadata(f.client);assert.deepEqual(report.models.map(m=>m.model),['new']);
  f.state.groups=[];assert.deepEqual((await readDshModelMetadata(f.client)).models,[]);
});
test('DSH offline and failed auth show only explicit active config, never the web profile or built-ins',async t=>{
  const f=await fixture(t);f.write(path.join(f.dir,'profiles','custom','cordis.patch.yml'),'- id: llm-deepseek\n  config:\n    models:\n      - id: explicit-only\n');
  for(const fetcher of [async()=>{throw Error('synthetic-token');},async()=>new Response('denied',{status:403})]){
    const report=await readDshModelMetadata(f.client,{fetcher});assert.match(report.error,/未使用默认模型/);
    assert.deepEqual(report.models.map(m=>m.model),['explicit-only']);assert.doesNotMatch(JSON.stringify(report),/synthetic-token/);
  }
  f.write(path.join(f.dir,'profiles','custom','cordis.patch.yml'),'[]\n');
  assert.deepEqual((await readDshModelMetadata(f.client,{fetcher:async()=>{throw Error('offline');}})).models,[]);
});
test('DSH refuses redirects, mismatched origin and oversized or malformed catalogs without expanding defaults',async t=>{
  const f=await fixture(t);let calls=0;
  f.write(f.file,{...f.descriptor,url:'http://remote.invalid/?token=synthetic-token',origin:'http://remote.invalid'});
  assert.deepEqual((await readDshModelMetadata(f.client,{fetcher:async()=>{calls++;throw Error();}})).models,[]);assert.equal(calls,0);
  f.write(f.file,{...f.descriptor,origin:'http://127.0.0.1:1'});
  await readDshModelMetadata(f.client,{fetcher:async()=>{calls++;throw Error();}});assert.equal(calls,0);
  f.write(f.file,f.descriptor);
  for(const variant of ['badJson','badId','status']){
    f.state[variant]=variant==='status'?500:true;
    const report=await readDshModelMetadata(f.client);assert.deepEqual(report.models,[]);assert.ok(report.error);
    delete f.state[variant];
  }
  const fetcher=async(url,init)=>{
    assert.equal(init.redirect,init.method?'error':'manual');
    return init.method?new Response(' '.repeat(2*1024*1024+1)):new Response(null,{status:302,headers:{'set-cookie':'fake=synthetic-cookie'}});
  };
  assert.deepEqual((await readDshModelMetadata(f.client,{fetcher})).models,[]);
});
test('DSH restart invalidates a late catalog; cancellation does not publish local fallback',async t=>{
  const f=await fixture(t);f.state.onRequest=()=>{f.write(f.file,{...f.descriptor,ownerId:'new-host'});};
  const report=await readDshModelMetadata(f.client);assert.deepEqual(report.models,[]);assert.ok(report.error);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readDshModelMetadata(f.client,{signal:controller.signal}),/取消/);
});
test('DSH config changes invalidate old directory rows before another profile or key can reuse them',async t=>{
  const f=await fixture(t),report=await readDshModelMetadata(f.client),store={officialModels:[],providers:[]};
  const sources=()=>modelSources(store,{clients:[f.client]},{directories:{'native-dsh':report}}).find(p=>p.id==='native-dsh').models;
  assert.equal(sources().length,3);
  f.write(path.join(f.dir,'profiles','custom','cordis.patch.yml'),'- id: llm-deepseek\n  config:\n    models:\n      - id: edited\n');
  assert.deepEqual(sources().map(m=>m.model),['edited']);
  const fresh=await readDshModelMetadata(f.client);assert.deepEqual(fresh.accounts.deep.models.map(m=>m.model),['actual-a','actual-b']);
});
test('DSH bound suppliers do not hide runtime-only models when explicit config has no catalog',async t=>{
  const f=await fixture(t),report=await readDshModelMetadata(f.client);
  f.client.accounts[0].supplierId='saved';f.client.accounts[0].authType='api';
  const source=modelSources({officialModels:[],providers:[{id:'saved',models:[{model:'actual-a'},{model:'api-only'}]}]},
    {clients:[f.client]},{directories:{'native-dsh':report}}).find(p=>p.id==='native-dsh');
  assert.deepEqual(source.models.map(m=>m.model),['actual-b','custom-only']);
});

test('DSH same-key supplier has no extra empty native card after offline or fully represented refreshes',async t=>{
  const f=await fixture(t);f.client.accounts.splice(1);
  f.client.accounts[0].supplierId='saved';f.client.accounts[0].authType='api';
  const store={officialModels:[],providers:[{id:'saved',models:[{model:'actual-a'},{model:'actual-b'}]}]};
  for(const fetcher of [async()=>{throw Error('offline');},undefined,async()=>{throw Error('offline again');}]) {
    const report=await readDshModelMetadata(f.client,{fetcher});
    for(let repeat=0;repeat<2;repeat++) {
      const sources=modelSources(store,{clients:[f.client]},{directories:{'native-dsh':report}});
      assert.equal(sources.some(p=>p.id==='native-dsh'),false);
      assert.deepEqual(sources.find(p=>p.id==='saved').models,store.providers[0].models);
    }
  }
});

test('DSH empty independent account remains visible beside a represented account',async t=>{
  const f=await fixture(t);f.client.accounts[0].supplierId='saved';f.client.accounts[0].authType='api';
  const report=await readDshModelMetadata(f.client,{fetcher:async()=>{throw Error('offline');}});
  const source=modelSources({officialModels:[],providers:[{id:'saved',models:[]}]},{clients:[f.client]},
    {directories:{'native-dsh':report}}).find(p=>p.id==='native-dsh');
  assert.ok(source);assert.deepEqual(source.models,[]);assert.equal(source.accountCount,1);
});
