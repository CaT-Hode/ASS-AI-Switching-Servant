import React, { useEffect, useState } from "react";
import { Power, Loader2, RefreshCw } from "lucide-react";
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
  return (
    <section
      className="connection-status"
      aria-label={client.name + " 接入控制"}
    >
      <div className="connection-overview">
        <div className="connection-metrics">
          <span>
            {connection.mode === "native"
              ? "原生直连"
              : `${connection.active} 个请求`}
          </span>
          <span>{sessions.length} 个窗口</span>
          <span>{connection.files} 个配置文件</span>
          {connection.modelCount !== undefined && <span>{connection.modelCount} 个配置模型</span>}
        </div>
        {connection.mode === "native" ? (
          <small role={connection.syncError ? "alert" : undefined}>
            {connection.syncError
              ? `未同步：${connection.syncError}`
              : connection.pending
                ? "原生配置待同步，请先结束客户端任务。"
                : connection.enabled
                  ? "配置已写入；客户端加载状态待确认，必要时重启客户端。"
                  : "开启后注入已配置模型，保留原有登录。"}
          </small>
        ) : client.launcher?.kind === "desktop" ? (
          <small>桌面端已安装；独立账户与路由接入需要 OpenCode CLI。</small>
        ) : connection.syncError ? <small role="alert">未同步：{connection.syncError}</small> : connection.pending ? (
          <small>模型接入配置待同步；现有路由保持上次应用的配置。</small>
        ) : connection.enabled ? (
          <small>
            {client.id === "codex"
              ? "App 配置已接入，任务结束后重启生效。"
              : "API 路由仅影响从 ASS 新启动的窗口。"}
          </small>
        ) : null}
      </div>
      {connection.enabled && (
        <button
          type="button"
          className="icon-button"
          aria-label={`同步 ${client.name} ${connection.mode === "native" ? "原生配置" : "接入配置"}`}
          title="重新同步接入配置"
          disabled={!!busy || state.connections.busy}
          onClick={() => onManage({ scope: client.id, enabled: true })}
        >
          <RefreshCw size={16} />
        </button>
      )}
      <ConnectionPill {...{ client, state, busy, onManage }} />
    </section>
  );
}
export function ConnectionDialog({ request, onClose, onComplete }) {
  const [plan, setPlan] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setPlan(null);
    setError("");
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
        ? `开启 ${target} 接入？`
        : `断开 ${target} 接入？`;
  let warning = "正在检查接入状态…";
  if (plan) {
    if (plan.enabled) {
      warning = plan.codexConfig
        ? "将更新 Codex 的接入配置，请在任务结束后手动重启客户端。"
        : plan.native
          ? "将同步模型及其凭据。请先结束客户端任务；原有登录保留。"
          : `后续从 ASS 启动的 ${target} 将使用路由配置，不影响已有窗口。`;
    } else {
      const windows = plan.sessions.length
        ? `并关闭 ${plan.sessions.length} 个由 ASS 启动的窗口`
        : "";
      warning = `将恢复接口配置${windows}${plan.stopService ? "，停止路由服务" : ""}。请先结束任务，并退出自行启动的客户端。`;
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
      });
      onComplete(result.message);
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
