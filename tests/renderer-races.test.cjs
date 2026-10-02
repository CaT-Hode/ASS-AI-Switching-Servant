// Actual React DOM in an isolated Electron renderer; no production IPC or native data.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');
let app, page, root; const rendererErrors = [];
before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ass-renderer-regression-'));
  require('esbuild').buildSync({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {ProjectConversations} from './src/project-conversations.jsx';
    import {ConversationHistory} from './src/conversation-history.jsx'; import {ModelEditor} from './src/editors.jsx';
    const root=createRoot(document.getElementById('root'));
    window.mount=(name)=>flushSync(()=>root.render(React.createElement({project:ProjectConversations,history:ConversationHistory,model:ModelEditor}[name],
      name==='model'?{provider:{id:'p',name:'Test'},onSave:async()=>{},onClose:()=>{}}:
      {initialHarness:'codex',state:{preferences:{conversations:{}},harnesses:{clients:[{id:'codex',detected:true,accounts:[]}]}},onClose:()=>{},onChange:()=>{}})));`,
    resolveDir: path.resolve(__dirname, '..'), loader: 'jsx' }, bundle: true, outfile: path.join(root, 'renderer.js'), platform: 'browser', logLevel: 'silent' });
  fs.writeFileSync(path.join(root, 'index.html'), '<html><head><title>ASS renderer regression</title></head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
  fs.writeFileSync(path.join(root, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(root,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});w.loadURL('about:blank')});`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), path.join(root, 'main.cjs')], env }); page = await app.firstWindow(); page.setDefaultTimeout(process.env.CI ? 15000 : 5000);
  page.on('pageerror', error => rendererErrors.push(error.message));
  await page.context().route(/^https?:/, route => route.abort());
  await page.addInitScript(() => {
    window.calls = []; window.pending = {};
    const wait = key => new Promise((resolve,reject) => { window.pending[key]={resolve,reject}; });
    window.ass = { call: async (name,...args) => {
      window.calls.push([name,...args]);
      if(window.failList && ['project-conversations-records','conversations-backups'].includes(name)) { window.failList=false; throw Error('Synthetic listing failure'); }
      const row = (short=false) => ({id:short?'short':'long',title:short?'Short':'Long',kind:'native',harness:'codex',available:true,nativePresent:true,capturedAt:'2026-10-02',file:'fake',backupBytes:1});
      if(name==='project-conversations-list') return {items:[{id:'p',name:'Project',cwd:'fake',enabled:false,targets:['codex'],counts:{codex:41},harnesses:['codex']}]};
      if(name==='project-conversations-records') return {total:41,items:[row(args[1].offset>0)]};
      if(name==='conversations-backups') return window.emptyList?{total:0,bytes:0,items:[]}:{total:41,bytes:1,items:[row(args[0].offset>0)]};
      if(name==='project-conversations-native-preview'||name==='conversations-backup-preview') {
        if(window.failPreview) {window.failPreview=false;throw Error('Synthetic preview failure');}
        if(window.deferPreview) {window.deferPreview=false;return wait('preview');}
        const [id,before]=args; return {total:id==='short'?1:80,hasEarlier:id==='long'&&!before,messages:id==='short'&&before?[]:[{role:'assistant',text:id==='short'?'Short answer':before?'Earlier answer':'Latest answer'}]}; }
      if(name==='project-conversations-trash') { if(window.deferTrash) return wait('trash'); return {items:[{id:'deleted',label:'Deleted',count:1,bytes:1,phase:'deleted'}]}; }
      if(name==='project-conversations-restore') return wait('restore');
      if(name==='model-defaults') return wait('defaults');
      return {};
    }};
  });
});
after(async () => { await app?.close(); if(root) fs.rmSync(root,{recursive:true,force:true}); });
beforeEach(async () => { rendererErrors.length = 0; await page.goto('file:///' + path.join(root,'index.html').replaceAll('\\','/')); });
afterEach(() => assert.deepEqual(rendererErrors, [], 'no uncaught React renderer errors'));
const mount = name => page.evaluate(name => window.mount(name), name);
for (const earlier of [false, true]) test(`renderer history: failed next page and return to same row reloads transcript at ${earlier ? 40 : 0}`, async () => {
  await mount('history'); await page.getByText('Latest answer', {exact:true}).waitFor();
  if(earlier) { await page.getByRole('button',{name:'更早内容',exact:true}).click(); await page.getByText('Earlier answer',{exact:true}).waitFor(); }
  for(let i=0;i<2;i++) {
    await page.evaluate(()=>{window.failList=true;});
    await page.getByRole('button',{name:'下一页副本',exact:true}).click();
    await page.getByRole('alert').getByText('Synthetic listing failure',{exact:true}).waitFor();
    await page.getByRole('button',{name:'上一页副本',exact:true}).click();
    await page.getByText(earlier?'Earlier answer':'Latest answer',{exact:true}).waitFor();
  }
  await page.getByRole('button',{name:/^Long/}).click(); await page.getByText('Latest answer',{exact:true}).waitFor();
});
test('renderer history: selecting same row retries failed preview, empty page clears it and late preview cannot win', async () => {
  await page.evaluate(()=>{window.failPreview=true;}); await mount('history');
  await page.getByRole('alert').getByText('Synthetic preview failure',{exact:true}).waitFor();
  await page.getByRole('button',{name:/^Long/}).click(); await page.getByText('Latest answer',{exact:true}).waitFor();
  await page.evaluate(()=>{window.deferPreview=true;});
  await page.getByRole('button',{name:'更早内容',exact:true}).click(); await page.waitForFunction(()=>!!window.pending.preview);
  await page.getByRole('button',{name:'下一页副本',exact:true}).click(); await page.getByText('Short answer',{exact:true}).waitFor();
  await page.evaluate(()=>window.pending.preview.resolve({total:80,hasEarlier:false,messages:[{role:'assistant',text:'Stale preview'}]}));
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await page.getByText('Stale preview',{exact:true}).count(),0);
  await page.getByRole('button',{name:'上一页副本',exact:true}).click(); await page.getByText('Latest answer',{exact:true}).waitFor();
  await page.getByRole('button',{name:'保留当前对话',exact:true}).click(); await page.getByText('Latest answer',{exact:true}).waitFor();
  assert.equal(await page.title(),'ASS renderer regression'); assert.match(page.url(), /index\.html$/);
  assert.equal(await page.locator('vite-error-overlay').count(),0);
  await page.screenshot({path:path.join(os.tmpdir(),'ass-round4-history-fixed.png')});
  await page.evaluate(()=>{window.emptyList=true;}); await page.getByRole('button',{name:'下一页副本',exact:true}).click();
  await page.getByText('暂无保留副本',{exact:true}).waitFor(); assert.equal(await page.getByText('Latest answer',{exact:true}).count(),0);
});
for (const kind of ['project','history']) test(`renderer ${kind}: automatic page selection resets transcript offset and repeats safely`, async () => {
  await mount(kind); await page.getByText('Latest answer',{exact:true}).waitFor();
  await page.getByRole('button',{name:'更早内容',exact:true}).click(); await page.getByText('Earlier answer',{exact:true}).waitFor();
  await page.getByRole('button',{name:kind==='history'?'下一页副本':'下一页对话',exact:true}).click();
  await page.getByText('Short answer',{exact:true}).waitFor();
  await page.getByRole('button',{name:kind==='history'?'上一页副本':'上一页对话',exact:true}).click();
  await page.getByText('Latest answer',{exact:true}).waitFor();
});
for (const kind of ['project','history']) test(`renderer ${kind}: failed page load is recoverable and subsequent short transcript stays visible`, async () => {
  await mount(kind); await page.getByText('Latest answer',{exact:true}).waitFor();
  await page.getByRole('button',{name:'更早内容',exact:true}).click(); await page.getByText('Earlier answer',{exact:true}).waitFor();
  await page.evaluate(()=>{window.failList=true;});
  await page.getByRole('button',{name:kind==='history'?'下一页副本':'下一页对话',exact:true}).click();
  await page.getByRole('alert').getByText('Synthetic listing failure',{exact:true}).waitFor();
  if(kind==='project') await page.getByRole('button',{name:'刷新项目记录',exact:true}).click();
  else {await page.getByRole('button',{name:'上一页副本',exact:true}).click();await page.getByRole('button',{name:'下一页副本',exact:true}).click();}
  await page.getByText('Short answer',{exact:true}).waitFor();
});
test('renderer recovery: normal completion refreshes an open panel and repeats safely',async()=>{
  await mount('project');await page.getByRole('button',{name:'已删除记录',exact:true}).click();
  for(let i=0;i<2;i++) {
    await page.getByRole('button',{name:'恢复',exact:true}).click();
    await page.evaluate(()=>window.pending.restore.resolve({message:'Restored'}));
    await page.waitForFunction(()=>![...document.querySelectorAll('.conversation-trash-panel button')].find(b=>b.textContent.includes('恢复'))?.disabled);
    assert.equal(await page.getByRole('dialog',{name:'已删除记录',exact:true}).count(),1);
  }
});
for(const failed of [false,true]) test(`renderer recovery: closing panel rejects late ${failed?'failure':'success'} and reopening still works`, async () => {
  await mount('project'); await page.getByRole('button',{name:'已删除记录',exact:true}).click();
  await page.getByRole('button',{name:'恢复',exact:true}).click();
  await page.getByRole('button',{name:'关闭已删除记录',exact:true}).click();
  await page.evaluate(failed => failed?window.pending.restore.reject(Error('Synthetic failure')):window.pending.restore.resolve({message:'Restored'}),failed);
  await page.waitForFunction(() => !document.querySelector('.project-conversation-page .spin') && !document.querySelector('button[aria-label="历史与存储"][disabled]'));
  // Wait until the action has completed via its final enabled controls, not a state replay.
  await page.getByRole('button',{name:'历史与存储',exact:true}).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b=>b.textContent.includes('历史与存储'))?.disabled);
  assert.equal(await page.getByRole('dialog',{name:'已删除记录',exact:true}).count(),0);
  await page.getByRole('button',{name:'已删除记录',exact:true}).click();
  await page.getByRole('dialog',{name:'已删除记录',exact:true}).waitFor();
});
test('renderer recovery: late list request cannot reopen a closed panel',async()=>{
  await mount('project'); await page.getByRole('button',{name:'已删除记录',exact:true}).click();
  await page.evaluate(()=>{window.deferTrash=true;});
  await page.getByRole('button',{name:'已删除记录',exact:true}).click();
  await page.getByRole('button',{name:'关闭已删除记录',exact:true}).click();
  await page.evaluate(()=>window.pending.trash.resolve({items:[]}));
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await page.getByRole('dialog',{name:'已删除记录',exact:true}).count(),0);
});
for(const failed of [false,true]) test(`renderer model: stale defaults ${failed?'failure':'success'} preserves later input; next request works`,async()=>{
  await mount('model'); const input=page.getByRole('textbox',{name:'模型 ID',exact:true});
  await input.fill('old'); await page.getByRole('textbox',{name:'显示名称',exact:true}).click();
  await input.fill('new');
  await page.evaluate(failed=>failed?window.pending.defaults.reject(Error('Old default failed')):window.pending.defaults.resolve({model:'old',displayName:'Old',efforts:['low'],defaultEffort:'low'}),failed);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await input.inputValue(),'new'); assert.equal(await page.getByText('Old default failed',{exact:true}).count(),0);
  await page.getByRole('textbox',{name:'显示名称',exact:true}).click();
  await page.evaluate(()=>window.pending.defaults.resolve({model:'new',displayName:'New',efforts:['max'],defaultEffort:'max'}));
  await page.waitForFunction(()=>document.querySelector('input[placeholder="例如 xiaomi/mimo-x-pro-preview"]').value==='new' && [...document.querySelectorAll('input')].some(i=>i.value==='New'));
});
