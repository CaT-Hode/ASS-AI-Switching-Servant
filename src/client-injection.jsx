import React, { useState } from "react";
import { Layers3, Terminal, Settings2 } from "lucide-react";
const api = window.ass;

export function ClientInjection({ client, state, act, busy }) {
  const [launchRef, setLaunchRef] = useState("");
  const injection = client.injection || { models: [], excluded: [], defaultModel: null };
  const included = injection.models.filter((m) => m.included);
  const groups = Map.groupBy(injection.models, (m) => m.providerId);
  const chosen = included.some((m) => m.ref === launchRef) ? launchRef : injection.defaultModel || included[0]?.ref || "";
  const connection = state.connections.clients[client.id];
  const save = (changes) => act("client-injection", () => api.call("client-injection", client.id, changes));
  return <section className="client-injection" aria-label={client.name + " 模型接入"}>
    <header><h3><Layers3 size={16} />模型接入 <span className="count">{included.length}</span></h3>
      <span className="hint">来自供应商与模型</span></header>
    <div className="client-model-launch">
      <select aria-label={client.name + " 接入模型"} value={chosen} onChange={(e) => setLaunchRef(e.target.value)} disabled={!included.length}>
        {!included.length && <option value="">没有兼容模型</option>}
        {included.map((m) => <option key={m.ref} value={m.ref}>{m.providerName} / {m.name}</option>)}
      </select>
      <button className="button" title={connection.pending ? "请先同步模型接入配置" : undefined}
        disabled={!!busy || !client.executable || !chosen || !connection.enabled || connection.pending || !!connection.syncError}
        onClick={() => act("client-model-launch", () => api.call("client-model-launch", client.id, chosen))}>
        <Terminal size={14} />启动模型
      </button>
    </div>
    {client.id === "claude" && included.length > 0 && <small className="hint">从此处启动 API 模型窗口；窗口内 /model 使用完整的 供应商::模型 ID。官方账户窗口保持原有登录。</small>}
    <details key={client.id}>
      <summary><Settings2 size={14} />接入范围与默认模型</summary>
      <label className="field">默认模型
        <select disabled={!!busy} aria-label={client.name + " 默认接入模型"} value={injection.defaultModel || ""}
          onChange={(e) => save({ defaultModel: e.target.value || null })}>
          <option value="">保留客户端默认模型</option>
          {included.map((m) => <option key={m.ref} value={m.ref}>{m.providerName} / {m.name}</option>)}
        </select>
      </label>
      <div className="client-injection-groups">
        {[...groups].map(([id, models]) => <section key={id}><h4>{models[0].providerName}</h4>
          {models.map((m) => <label className="client-injection-model" key={m.ref}>
            <input type="checkbox" disabled={!!busy || !!m.issue} checked={m.included} onChange={(e) => {
              const excluded = e.target.checked ? injection.excluded.filter((ref) => ref !== m.ref) : [...injection.excluded, m.ref];
              save({ excluded, ...(injection.defaultModel === m.ref && !e.target.checked ? { defaultModel: null } : {}) });
            }} />
            <span>{m.name}<small>{client.id === "claude" ? m.providerId + "::" + m.model : m.model}</small></span><small>{m.issue || m.protocol}</small>
          </label>)}
        </section>)}
      </div>
    </details>
  </section>;
}
