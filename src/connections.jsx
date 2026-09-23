import React, { useEffect, useState } from "react";
import { Power, Loader2 } from "lucide-react";
import { Modal } from "./editors.jsx";
import "./connections.css";
const api = window.ass;
export function ConnectionPill({ client, state, onManage, busy }) {
  const enabled = state.connections.clients[client.id].enabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={client.name + " ASS 接入"}
      title={
        enabled
          ? "断开 " + client.name + " 接入"
          : "开启 " + client.name + " 接入"
      }
      className="connection-switch"
      disabled={!!busy || state.connections.busy}
      onClick={() => onManage({ scope: client.id, enabled: !enabled })}
    >
      <span>{enabled ? (state.connections.clients[client.id].syncError ? "接入异常" : state.connections.clients[client.id].pending ? "待同步" : "接入已开启") : "未接入"}</span>
      <span className="connection-pill-track" aria-hidden="true">
        <i />
      </span>
    </button>
  );
}
export function ConnectionStatus({ client, state, busy, onManage }) {
  const connection = state.connections.clients[client.id];
  const sessions = state.connections.processes.sessions.filter(
    (s) => s.harness === client.id && s.status !== "gone",
  );
  if (!connection || client.injectionUnsupported) return null;
  const note = connection.syncError ? `未同步：${connection.syncError}` : connection.pending ? "供应商接入有变更，点击同步后生效。" :
    connection.enabled ? (connection.mode === "native" ? "已写入原生配置 · 新会话生效" : client.id === "codex" ? "已接入 · 任务结束后重启客户端" : "已接入 · 新窗口生效") : "";
  if (!note && !sessions.length && !connection.active) return null;
  return (
    <section
      className="connection-status"
      aria-label={client.name + " 接入控制"}
    >
      <div className="connection-overview">
        <small role={connection.syncError ? "alert" : "status"}>{note}</small>
        {(sessions.length > 0 || connection.active > 0) && <div className="connection-metrics">
          {connection.active > 0 && <span>{connection.active} 个请求</span>}
          {sessions.length > 0 && <span>{sessions.length} 个窗口</span>}
        </div>}
      </div>
    </section>
  );
}
export function ConnectionDialog({ request, onClose, onComplete }) {
  const [plan, setPlan] = useState(null),
    [error, setError] = useState(""),
    [restart, setRestart] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setPlan(null);
    setError("");
    setRestart(false);
    api
      .call(
        "connection-preview",
        request.scope,
        request.enabled,
        !!request.quit,
      )
      .then((p) => {
        if (active) setPlan(p);
      })
      .catch((e) => {
        if (active)
          setError(
            e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            ),
          );
      });
    return () => {
      active = false;
    };
  }, [request.scope, request.enabled, request.quit]);
  const target = plan?.names.join("、") || "客户端";
  const title = request.quit
    ? "退出 ASS？"
    : request.scope === "all"
      ? "停止全部接入？"
      : request.enabled
        ? `${request.sync ? "同步" : "开启"} ${target} 接入？`
        : `断开 ${target} 接入？`;
  let warning = "正在检查接入状态…";
  if (plan) {
    if (plan.enabled) {
      warning = plan.codexConfig
        ? restart ? "将更新 Codex 的接入配置。请先结束任务。" : "将更新 Codex 的接入配置，请在任务结束后手动重启客户端。"
        : plan.native
          ? "将同步模型及其凭据。请先结束客户端任务；原有登录保留。"
          : `后续从 ASS 启动的 ${target} 将使用路由配置，不影响已有窗口。`;
    } else {
      const windows = plan.sessions.length
        ? `并关闭 ${plan.sessions.length} 个由 ASS 启动的窗口`
        : "";
      warning = `将恢复接口配置${windows}${plan.stopService ? "，停止路由服务" : ""}。${restart ? "请先结束任务。" : "请先结束任务，并退出自行启动的客户端。"}`;
      if (plan.quit && plan.retainedNative?.length)
        warning = `将退出 ASS 并关闭依赖路由的接入${windows}。${plan.retainedNative.join("、")} 的直连配置与窗口保留。`;
    }
  }
  async function commit() {
    if (!plan || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.call("connection-apply", {
        ticket: plan.ticket,
        mode: plan.enabled ? "safe" : "terminate",
        acknowledged: true,
        restart,
      });
      onComplete(result.message, result.restart?.ok === false);
      onClose();
    } catch (e) {
      setError(
        e.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
      );
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={title}
      className="connection-confirm"
      closeButton={false}
      dismissible={!busy}
      onClose={onClose}
    >
      <p
        className="connection-confirm-message"
        role={error ? "alert" : "status"}
      >
        {error || warning}
      </p>
      {plan?.restart?.applicable && !request.quit && <div className="connection-restart">
        <label>
          <input type="checkbox" checked={restart} disabled={busy || !plan.restart.available}
            onChange={(e) => setRestart(e.target.checked)} />
          <span>立即重启{plan.restart.names.length ? " " + plan.restart.names.join("、") : "客户端"}</span>
        </label>
        <small>{restart ? "会强制关闭所选客户端及其任务，再重新打开。" : plan.restart.available ? "默认不重启，可在任务结束后手动重启。" : plan.restart.reason}</small>
      </div>}
      <footer>
        <button
          className="button"
          data-autofocus
          disabled={busy}
          onClick={onClose}
        >
          取消
        </button>
        <button
          className="button primary"
          disabled={!plan || busy}
          onClick={commit}
        >
          {busy && <Loader2 size={14} className="spin" />}
          {request.quit ? "直接退出" : "确定"}
        </button>
      </footer>
    </Modal>
  );
}
export function ConnectionService({ state, onManage, busy }) {
  return (
    <div className="connection-service">
      <div>
        <strong>服务与接入管理</strong>
        <p>停止全部接入并恢复接口配置，账户和会话保留。</p>
      </div>
      <button
        className="button"
        disabled={busy || state.connections.busy}
        onClick={() => onManage({ scope: "all", enabled: false })}
      >
        <Power size={15} />
        停止全部接入与服务…
      </button>
    </div>
  );
}
