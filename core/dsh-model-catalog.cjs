// Use the same RPC as DSH's picker, never a fixed default or a remote /models.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const dsh = require('./dsh-config.cjs');
const { safePath } = require('./native-fields.cjs');
const { nativeModels } = require('./model-inventory.cjs');
const { EFFORTS } = require('./models.cjs');
const text = value => typeof value === 'string' && value.length <= 250 && !/[\x00-\x1f\x7f]/.test(value);
function descriptor(dir) {
  const file = dsh.runtimeFile(dir); if (!file) throw Error('DSH 运行目录不存在');
  safePath(file); if(fs.statSync(file).size > 65536) throw Error('DSH 运行记录过大');
  const bytes=fs.readFileSync(file), raw=JSON.parse(bytes), url=new URL(raw.url);
  if(url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
    url.origin !== raw.origin || url.username || url.password || url.pathname !== '/' ||
    !url.searchParams.get('token') || [...url.searchParams.keys()].some(key => key !== 'token')) throw Error('DSH 本机地址无效');
  const profile=dsh.validProfile(raw.profile);
  return {file,url,profile,stamp:crypto.createHash('sha256').update(bytes).digest('hex')};
}
async function jsonResponse(response) {
  if(!response.ok) {await response.body?.cancel();throw Error('DSH 目录请求失败');}
  const reader=response.body?.getReader(); if(!reader) throw Error('DSH 目录响应为空');
  const chunks=[];let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>2*1024*1024)throw Error('DSH 目录响应过大');chunks.push(Buffer.from(value));}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function catalog(dir, {signal, fetcher=fetch}={}) {
  const runtime=descriptor(dir), context=dsh.catalogStamp(dir), requestSignal=signal ? AbortSignal.any([signal,AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
  const login=await fetcher(runtime.url.href,{redirect:'manual',signal:requestSignal,cache:'no-store'});
  if(!login.ok && ![302,303].includes(login.status)){await login.body?.cancel();throw Error('DSH 本机授权失败');}
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');await login.body?.cancel();
  if(!cookie)throw Error('DSH 本机授权未返回会话');
  const method='session/modelCatalog',rpcId=crypto.randomUUID();
  const response=await fetcher(runtime.url.origin+'/api/'+method,{method:'POST',redirect:'error',signal:requestSignal,
    headers:{cookie,origin:runtime.url.origin,'content-type':'application/json'},
    body:JSON.stringify({type:'client-request',rpcId,method,payload:{args:{}}})});
  const message=await jsonResponse(response), data=message.result?.value;
  if(message.rpcId!==rpcId || message.result?.ok!==true || !Array.isArray(data?.groups) || data.groups.length>100 ||
    data.groups.some(group=>!text(group.id)||!Array.isArray(group.models)) ||
    data.groups.reduce((n,g)=>n+g.models.length,0)>10000 || data.failures && !Array.isArray(data.failures))throw Error('DSH 模型目录格式无效');
  if(descriptor(dir).stamp!==runtime.stamp || dsh.catalogStamp(dir)!==context)throw Error('DSH 运行目标已经变化');
  return {data,profile:runtime.profile,context};
}
async function readDshModelMetadata(client, {home='',env={},signal,fetcher}={}) {
  const accounts={},errors=[],jobs=new Map();
  for(const account of (client.modelAccounts||client.accounts).filter(a=>a.kind!=='api')) {
    if(signal?.aborted)throw Error('目录读取已取消');
    const dir=account.nativeDir||path.dirname(account.sourcePath||''),local=nativeModels(client,account,home,env);
    if(!jobs.has(dir)) jobs.set(dir,catalog(dir,{signal,fetcher}).then(value=>({value}),()=>({failed:true})));
    const result=await jobs.get(dir);
    if(signal?.aborted)throw Error('目录读取已取消');
    if(result.failed) {
      let context;try {context=dsh.catalogStamp(dir);}catch{}
      accounts[account.id]={models:local,context};errors.push('DSH 实际目录暂不可读，仅显示显式配置；请启动 DSH 后刷新，未使用默认模型');continue;
    }
    let settings={};try {settings=dsh.readSettings(dir,()=>({}));}catch{}
    const provider=account.provider||account.oauthProvider||account.providers?.[0];
    const official=['DEEPSEEK_API_KEY','deepseek','deepseek-official',settings['llm-deepseek']?.apiKeyEnv].filter(Boolean).includes(provider);
    const ids=official?['deepseek','deepseek-official']:[provider];
    const groups=result.value.data.groups.filter(group=>ids.includes(group.id)),models=new Map();
    if(result.value.data.failures?.some(f=>ids.includes(f.id)))errors.push('DSH 当前供应商的实际目录读取失败，未填充默认模型');
    for(const group of groups)for(const raw of group.models) {
      if(!text(raw?.id)||!raw.id || models.has(raw.id))continue;
      const cached=local.find(m=>m.model===raw.id),efforts=(Array.isArray(raw.reasoning?.efforts)?raw.reasoning.efforts:[]).map(e=>e?.id).filter(e=>EFFORTS.includes(e));
      const defaultEffort=raw.reasoning?.defaultEffort;
      models.set(raw.id,{...cached,model:raw.id,displayName:text(raw.name)&&raw.name?raw.name:raw.id,
        wireApi:cached?.wireApi||(official?'openai-chat':''),contextWindow:cached?.contextWindow||null,
        efforts,defaultEffort:efforts.includes(defaultEffort)?defaultEffort:null,enabled:true,
        nativeProvider:official?'deepseek-official':group.id,catalogSource:'DSH 运行时目录 · '+result.value.profile});
    }
    accounts[account.id]={models:[...models.values()],context:result.value.context};
  }
  return {accounts,models:Object.values(accounts).flatMap(a=>a.models),time:new Date().toISOString(),
    source:'DSH 实际模型目录',error:[...new Set(errors)].join('；')||undefined};
}
module.exports={readDshModelMetadata};
