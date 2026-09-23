const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { HarnessManager } = require('../core/harnesses.cjs');
const { parseImport } = require('../core/models.cjs');
const { injectionCatalog, modelRef } = require('../core/client-policy.cjs');
const { NativeConfig, locations } = require('../core/native-config.cjs');
function fixture(t, saved) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ass-provider-selection-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const data = path.join(root, 'data'), home = path.join(root, 'home');
  fs.mkdirSync(data); fs.mkdirSync(home);
  if (saved) fs.writeFileSync(path.join(data,'clients.json'),JSON.stringify(saved));
  const providers = parseImport({providers:[{id:'work',baseUrl:'https://relay.test/v1',apiKey:'synthetic-only',models:[{model:'one',wireApi:'openai-chat'},{model:'two',wireApi:'anthropic'}]}]});
  const create = () => new HarnessManager(data, () => ({providers}), [], path.join(home,'.codex'), {home,env:{},launchEnv:{PATH:'',USERPROFILE:home},isConnected:()=>false});
  return {data,home,providers,create,manager:create()};
}
test('model-level exclusions migrate whole provider OFF once with exact backup and no native writes', t => {
  const saved = {schemaVersion:2,injections:{pi:{excluded:[modelRef('work','one')],defaultModel:modelRef('work','two')}},selected:{},profiles:[]};
  const f=fixture(t,saved);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.data,'clients.before-provider-injection.json'))),saved);
  assert.deepEqual(f.manager.state.injections.pi,{excludedProviders:['work']});
  assert.equal(f.manager.injection('pi').models.filter(m=>m.included).length,0);
  assert.deepEqual(fs.readdirSync(f.home),[]);
  f.manager.setInjection('pi',{excludedProviders:[]});
  assert.equal(f.create().injection('pi').models.filter(m=>m.included).length,2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.data,'clients.before-provider-injection.json'))),saved);
});
test('provider selection covers future models, is per client and does not change account state', t => {
  const f=fixture(t); f.manager.setInjection('pi',{excludedProviders:['work']});
  f.providers[0].models.push({...f.providers[0].models[0],model:'three'});
  assert.equal(f.manager.injection('pi').models.filter(m=>m.included).length,0);
  assert.equal(f.manager.injection('dsh').models.filter(m=>m.included).length,3);
  assert.deepEqual(f.manager.state.selected,{});
  assert.throws(()=>f.manager.setInjection('pi',{defaultModel:modelRef('work','one')}),/按供应商/);
  assert.throws(()=>f.manager.setInjection('pi',{excluded:[modelRef('work','one')]}),/按供应商/);
  assert.throws(()=>f.manager.setInjection('pi',{excludedProviders:['']}),/无效/);
  const before=structuredClone(f.manager.state.injections.pi);
  f.manager.save=()=>{throw Error('disk failure')};
  assert.throws(()=>f.manager.setInjection('pi',{excludedProviders:[]}),/disk failure/);
  assert.deepEqual(f.manager.state.injections.pi,before);
});
test('schema3 initializes missing clients correctly and restart can parse the resulting save', t => {
  const f=fixture(t,{schemaVersion:3,injections:{pi:{excludedProviders:[]}}});
  f.manager.save(); assert.deepEqual(f.create().state.injections.dsh,{excludedProviders:[]});
});
test('fresh empty native injection refuses enable; previously applied all-off restores keys and survives restart', t => {
  const f=fixture(t), crypt={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const n=new NativeConfig(f.data,crypt,f.manager);
  f.manager.setInjection('pi',{excludedProviders:['work']});
  assert.throws(()=>n.preflight(['pi'],true),/没有可接入/);
  f.manager.setInjection('pi',{excludedProviders:[]}); n.sync('pi');
  const target=locations('pi',f.manager), before=fs.readFileSync(target.auth);
  f.manager.setInjection('pi',{excludedProviders:['work']});
  assert.deepEqual(fs.readFileSync(target.auth),before,'draft never applies on its own');
  assert.equal(n.status('pi',true).pending,true); n.sync('pi');
  assert.deepEqual(JSON.parse(fs.readFileSync(target.auth)),{});
  f.manager.options.isConnected=()=>true;
  const restarted=new NativeConfig(f.data,crypt,f.manager);
  assert.equal(restarted.status('pi',true).applied,true);
  assert.equal(restarted.sync('pi').modelCount,0);
});
test('recognized clients require installed entry or actual credential source, not saved providers or empty auth files', t => {
  const f=fixture(t);
  assert.ok(f.manager.snapshot().clients.every(c=>!c.detected));
  const dir=path.join(f.home,'.codex'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,'auth.json'),'{}');
  assert.equal(f.manager.snapshot().clients.find(c=>c.id==='codex').detected,false);
  fs.writeFileSync(path.join(dir,'auth.json'),JSON.stringify({OPENAI_API_KEY:'synthetic-key'}));
  assert.equal(f.manager.snapshot().clients.find(c=>c.id==='codex').detected,true);
  f.manager.discovery.pi=[{ready:true,location:path.join(f.home,'removed','pi.cmd')}];
  assert.equal(f.manager.snapshot().clients.find(c=>c.id==='pi').detected,false);
});
test('overview honors explicit not-detected and supports older snapshots only with concrete launcher evidence', async () => {
  const {detectedClients}=await import('../src/usage-view.mjs');
  const state={harnesses:{clients:[{id:'codex',detected:true},{id:'pi',detected:false,executable:'stale'},{id:'claude',accounts:[{}]},{id:'opencode',launcher:{installed:true}}]}};
  assert.deepEqual(detectedClients(state).map(c=>c.id),['codex','opencode']);
});
