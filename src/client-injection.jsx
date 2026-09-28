import React from "react";
import { ChevronRight, Layers3, RefreshCw, BrandMotion, Terminal } from "./icons.jsx";
import { providerBrand } from "./provider-brand.mjs";
const api = window.ass;
const protocols = { "openai-chat": "Chat Completions", "openai-responses": "Responses", anthropic: "Anthropic Messages" };

export function ClientInjection({ client, state, act, busy, onManage }) {
  const injection = client.injection || { models: [], excludedProviders: [] };
  const groups = Map.groupBy(injection.models, (m) => m.providerId);
  const connection = state.connections.clients[client.id];
  const accountlessHint = !connection?.accountless ? "注入模型后可开启"
    : !connection.applied ? connection.syncError ? "无账号配置异常 · 请修复接入" : "无账号配置待同步"
    : client.id === "claude" ? "Claude Code 终端免登录 · ASS 需保持运行"
    : "仅使用注入模型 · 已运行的 Codex 需重启";
  const excluded = new Set(injection.excludedProviders || []);
  const enabled = [...groups].filter(([id, models]) => !excluded.has(id) && models.some((m) => !m.issue)).length;
  return <section className="client-injection" aria-label={client.name + " 模型接入"}>
    <header><h3>供应商接入 {!client.injectionUnsupported && <span className="injection-count" title="已纳入 / 已配置供应商" aria-label={`已纳入 ${enabled} 个供应商，共 ${groups.size} 个`}>{enabled} / {groups.size}</span>}</h3>
      {connection?.enabled && <button className="icon-button" aria-label={`同步 ${client.name} ${connection.mode === "native" ? "原生配置" : "接入配置"}`}
        title="同步供应商接入" disabled={!!busy || state.connections.busy}
        onClick={() => onManage({ scope: client.id, enabled: true, sync: true })}><RefreshCw size={16} /></button>}
    </header>
    {["codex", "claude"].includes(client.id) && <div className="accountless-control">
      <div><strong>无账号启动</strong><small>{accountlessHint}</small></div>
      {connection?.accountless && <button className="button" disabled={!!busy || !connection.accountlessAvailable || !(client.launcher?.ready || (client.id === "codex" && client.desktop))}
        title={client.id === "codex" && client.desktop ? "打开桌面端；已运行的窗口需重启加载配置" : client.id === "claude" ? "启动 Claude Code 命令行终端；Claude 桌面版使用独立的第三方推理配置" : "以独立配置启动，不读取官方 OAuth"}
        onClick={() => act("accountless-launch", () => api.call(client.id === "codex" && client.desktop ? "client-open-desktop" : "client-accountless-launch", client.id), client.id === "claude" ? "已打开 Claude Code 终端" : "已启动客户端")}>
        <Terminal size={15} />{client.id === "claude" ? "启动终端" : "启动"}</button>}
      <button type="button" role="switch" className="provider-injection-switch" aria-label={client.name + " 无账号启动"}
        aria-checked={!!connection?.accountless} disabled={!!busy || state.connections.busy || (!connection?.accountless && !connection?.accountlessAvailable)}
        title={!connection?.accountlessAvailable && !connection?.accountless ? "请先开启接入并同步至少一个模型" : "仅影响此客户端，官方登录保留"}
        onClick={() => onManage({ scope: client.id, enabled: true, accountless: !connection?.accountless, name: client.name })}><i /></button>
    </div>}
    {client.id === "claude" && (connection?.accountless || state.claudeDesktop?.owned) && <details className="claude-desktop-setup">
      <summary>Claude 桌面版免登录设置{state.claudeDesktop?.current && <small>已配置</small>}<ChevronRight size={15} /></summary>
      <div className="claude-desktop-setup-body">
        <div className="claude-desktop-setup-toggle"><span><strong>桌面版第三方推理</strong><small>{state.claudeDesktop?.conflict ? "检测到其他生效配置，ASS 不会覆盖" : state.claudeDesktop?.current ? "已接入；重新打开 Claude 后生效" : state.claudeDesktop?.owned ? "配置待同步，可关闭后重新开启" : "开启后无需 Anthropic 账户"}</small></span>
          <button type="button" role="switch" className="provider-injection-switch" aria-label="Claude 桌面版第三方推理"
            aria-checked={!!state.claudeDesktop?.owned} disabled={!!busy || (!state.claudeDesktop?.owned && (!!state.claudeDesktop?.conflict || !connection?.accountlessAvailable))}
            onClick={() => act("claude-desktop-configure", () => api.call("claude-desktop-configure", !state.claudeDesktop?.owned),
              state.claudeDesktop?.owned ? "桌面版接入已关闭；重新打开 Claude 后恢复原生登录" : "桌面版已配置；重新打开 Claude 后选择第三方推理")}><i /></button></div>
        <p>也可在 Claude 桌面版登录页打开 ☰ → 帮助 → 故障排除 → 启用开发者模式，再到 开发者 → 配置第三方推理，选择 Gateway 和 Static API key，填入下方信息并应用。</p>
        <div className="claude-desktop-setup-actions">
          <button className="button" onClick={() => act("claude-desktop-url", () => api.call("claude-desktop-copy", "url"), "网关地址已复制")}>复制网关地址</button>
          <button className="button" onClick={() => act("claude-desktop-key", () => api.call("claude-desktop-copy", "key"), "本机密钥已复制")}>复制本机密钥</button>
        </div>
        <small>应用后重新打开 Claude 桌面版，从登录页选择第三方推理。使用时 ASS 需保持运行。</small>
      </div>
    </details>}
    {client.injectionUnsupported ? <p className="client-support-note">{client.injectionUnsupported}</p> :
      groups.size ? <div className="client-provider-list">{[...groups].map(([id, models]) => {
        const provider = state.providers.find((p) => p.id === id);
        const brand = providerBrand(provider || {}, state.officialProviderIds?.[id]);
        const compatible = models.filter((m) => !m.issue);
        const checked = !excluded.has(id) && compatible.length > 0;
        return <section className="client-provider" key={id} aria-label={models[0].providerName + " 接入供应商"}>
          <details>
            <summary><span className="client-provider-logo motion-brand" aria-hidden="true">{brand ? <><img src={"./providers/" + brand + ".svg"} alt="" /><BrandMotion brand={brand} /></> : <Layers3 size={21} />}</span>
              <strong>{models[0].providerName}</strong><small>{compatible.length} 个模型</small><ChevronRight className="provider-disclosure" size={16} /></summary>
            <div className="client-provider-models">{models.map((m) => <div key={m.ref} className={m.issue ? "unavailable" : ""}>
              <span title={m.model}>{m.name || m.model}<small>{m.name !== m.model ? m.model : ""}</small></span>
              <small>{m.issue || m.adapter || protocols[m.protocol] || m.protocol}</small>
            </div>)}</div>
          </details>
          <button type="button" role="switch" className="provider-injection-switch" aria-label={models[0].providerName + " 供应商接入"}
            aria-checked={checked} disabled={!!busy || !compatible.length} title={!compatible.length ? "没有已启用的兼容模型或缺少凭据" : checked ? "排除此供应商" : "纳入此供应商"}
            onClick={() => { const next = new Set(excluded); checked ? next.add(id) : next.delete(id);
              act("client-injection", () => api.call("client-injection", client.id, { excludedProviders: [...next] }));
            }}><i /></button>
        </section>;
      })}</div> : <div className="injection-empty"><Layers3 size={20} /><span>暂无可接入的供应商</span></div>}
  </section>;
}
