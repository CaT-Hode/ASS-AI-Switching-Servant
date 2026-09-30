const { switchWithConversations } = require('./conversations.cjs');
async function switchClientAccount({ history, library, restarter, router, blocked, ticket, confirmed,
  mode = 'none', selectTarget, assertIdle = async () => {}, extraActive = () => 0 }) {
  if (!['none', 'close', 'restart'].includes(mode)) throw Error('未知客户端生效方式');
  const record = history.tickets.get(ticket);
  if (!record || confirmed !== true || record.expires < history.now()) throw Error('切换确认已失效，请重新选择账户');
  const id = record.harness, plan = record.lifecycle;
  if (mode !== 'none' && (!['codex', 'claude'].includes(id) || !restarter ||
    !(mode === 'restart' ? plan?.available : plan?.closeAvailable))) throw Error('没有已确认的客户端操作目标');
  await assertIdle(id);
  if (extraActive()) throw Error('连接检测仍在进行，请稍后切换账户');
  const current = history.inspect(id, history.lookup(id, record.id));
  if (current.fingerprint !== record.fingerprint) throw Error('登录信息已变化，请重新确认切换');
  let stopped = false;
  blocked.add(id);
  try {
    if (mode !== 'none') {
      await restarter[mode === 'close' ? 'close' : 'stop'](plan); stopped = true;
      await router.cancelClient(id);
    }
    if (router.clientActive(id)) throw Error('客户端仍有请求进行中，请稍后切换账户');
    const result = await switchWithConversations({ history, library, ticket, confirmed, selectTarget });
    if (mode === 'close') return { ...result, closed: true, message: '账户已切换，本地对话已保留；客户端已关闭，未重新启动。' };
    if (mode === 'restart') {
      let restarted;
      try { restarted = await restarter.launch(plan, () => blocked.delete(id)); } catch { restarted = { ok: false }; }
      return { ...result, restart: restarted, message: restarted.ok ? '账户已切换，本地对话已保留；客户端已重启。'
        : '账户已切换，本地对话已保留，但重启未完成；请手动打开客户端。' };
    }
    return result;
  } catch (e) {
    if (stopped) throw Error(`客户端已关闭，但账户切换未完成：${e.message}`, { cause: e });
    throw e;
  } finally { blocked.delete(id); }
}
module.exports = { switchClientAccount };
