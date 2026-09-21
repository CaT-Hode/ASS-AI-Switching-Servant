import React, { useEffect, useState } from "react";
import { ShieldCheck, Power, Loader2 } from "lucide-react";
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
      <span>{enabled ? "已接入" : "未接入"}</span>
      <span className="connection-pill-track" aria-hidden="true">
        <i />
      </span>
    </button>
  );
}
export function ConnectionStatus({ client, state }) {
  const connection = state.connections.clients[client.id];
  const sessions = state.connections.processes.sessions.filter(
    (s) => s.harness === client.id && s.status !== "gone",
  );
  return (
    <section
      className="connection-status"
      aria-label={client.name + " 接入控制"}
    >
      <div className="connection-metrics">
        <span>{connection.active} 个请求</span>
        <span>{sessions.length} 个窗口</span>
        <span>{connection.files} 个注入文件</span>
      </div>
      {connection.enabled && (
        <small>
          {client.id === "codex"
            ? "App 配置已接入，任务结束后重启生效。"
            : "API 路由仅影响从 ASS 新启动的窗口。"}
        </small>
      )}
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
        : `后续从 ASS 启动的 ${target} 将使用路由配置，不影响已有窗口。`;
    } else {
      const windows = plan.sessions.length
        ? `并关闭 ${plan.sessions.length} 个由 ASS 启动的窗口`
        : "";
      warning = `将恢复接口配置${windows}${plan.stopService ? "，停止路由服务" : ""}。请先结束任务，并退出自行启动的客户端。`;
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
          {busy && <Loader2 size={14} className="spin" />}确定
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
