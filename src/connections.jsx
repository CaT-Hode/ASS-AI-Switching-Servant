import React, { useEffect, useState } from "react";
import { ShieldCheck, ChevronRight, Power, Loader2 } from "lucide-react";
import { Modal } from "./editors.jsx";
import "./connections.css";
const api = window.ass;
export function ConnectionSwitch({ client, state, onManage, busy }) {
  const connection = state.connections.clients[client.id];
  const sessions = state.connections.processes.sessions.filter((s) => s.harness === client.id && s.status !== "gone");
  return <section className="connection-card" aria-label={client.name + " 接入控制"}>
    <div className="connection-card-top">
      <span className="connection-icon"><ShieldCheck size={20} /></span>
      <div><h3>ASS 接入</h3><p>{connection.enabled ? "已开启 · 新启动使用 ASS 配置" : "未接入 · API 注入已关闭"}</p></div>
      <button type="button" role="switch" aria-checked={connection.enabled} aria-label={client.name + " ASS 接入"}
        className="connection-switch" disabled={busy || state.connections.busy}
        onClick={() => onManage({ scope: client.id, enabled: !connection.enabled })}><span /></button>
    </div>
    <p className="connection-scope">{client.id === "codex"
      ? "同时管理 Codex App 配置与 ASS 启动的 CLI。变更后请在任务结束时手动重启 App。"
      : client.id === "dsh" ? "DeepSeek 等 API 账户通过本地接口接入；只影响从 ASS 启动的窗口，不改 DSH 原有全局配置。"
      : "只注入从 ASS 启动的 API 客户端；原生 OAuth 继续直连官方，不改原客户端全局配置。"}</p>
    <div className="connection-metrics"><span>{connection.active} 条进行中请求</span><span>{sessions.length} 个登记窗口</span><span>{connection.files} 个注入文件</span></div>
    <button className="text-button connection-details" disabled={busy || state.connections.busy}
      onClick={() => onManage({ scope: client.id, enabled: false })}>断开接入… <ChevronRight size={14} /></button>
  </section>;
}
export function ConnectionDialog({ request, onClose, onComplete }) {
  const [plan, setPlan] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setPlan(null); setError("");
    api.call("connection-preview", request.scope, request.enabled, !!request.quit)
      .then((p) => { if (active) setPlan(p); })
      .catch((e) => { if (active) setError(e.message.replace(/^Error invoking remote method '[^']+': Error: /, "")); });
    return () => { active = false; };
  }, [request.scope, request.enabled, request.quit]);
  const target = plan?.names.join("、") || "客户端";
  const title = request.quit ? "退出 ASS？" : request.scope === "all" ? "停止全部接入？"
    : request.enabled ? `开启 ${target} 接入？` : `断开 ${target} 接入？`;
  let warning = "正在检查接入状态…";
  if (plan) {
    if (plan.enabled) {
      warning = plan.codexConfig
        ? "将更新 Codex 的接入配置，请在任务结束后手动重启客户端。"
        : `后续从 ASS 启动的 ${target} 将使用路由配置，不影响已有窗口。`;
    } else {
      const windows = plan.sessions.length ? `并关闭 ${plan.sessions.length} 个由 ASS 启动的窗口` : "";
      warning = `将恢复接口配置${windows}${plan.stopService ? "，停止路由服务" : ""}。请先结束任务，并退出自行启动的客户端。`;
    }
  }
  async function commit() {
    if (!plan || busy) return;
    setBusy(true); setError("");
    try {
      const result = await api.call("connection-apply", {
        ticket: plan.ticket,
        mode: plan.enabled ? "safe" : "terminate",
        acknowledged: true,
      });
      onComplete(result.message); onClose();
    } catch (e) {
      setError(e.message.replace(/^Error invoking remote method '[^']+': Error: /, ""));
      setPlan(null);
    } finally { setBusy(false); }
  }
  return <Modal title={title} className="connection-confirm" closeButton={false}
    dismissible={!busy} onClose={onClose}>
    <p className="connection-confirm-message" role={error ? "alert" : "status"}>{error || warning}</p>
    <footer>
      <button className="button" data-autofocus disabled={busy} onClick={onClose}>取消</button>
      <button className="button primary" disabled={!plan || busy} onClick={commit}>
        {busy && <Loader2 size={14} className="spin" />}确定
      </button>
    </footer>
  </Modal>;
}
export function ConnectionService({ state, onManage, busy }) {
  return <div className="connection-service"><div><strong>服务与接入管理</strong><p>停止全部接入并恢复接口配置，账户和会话保留。</p></div><button className="button" disabled={busy || state.connections.busy} onClick={() => onManage({ scope: "all", enabled: false })}><Power size={15} />停止全部接入与服务…</button></div>;
}
