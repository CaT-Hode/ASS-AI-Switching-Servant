import React, { useEffect, useState } from "react";
import { Power, Loader2, Wrench, SlidersHorizontal, RotateCw } from "./icons.jsx";
import { Modal } from "./editors.jsx";
import "./connections.css";
const api = window.ass;
export function ConnectionPill({ client, state, onManage, busy }) {
  const connection = state.connections.clients[client.id], enabled = connection.enabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={client.name + " ASS 接入"}
      title={
        connection.syncError ? "查看并修复 " + client.name + " 接入" : enabled
          ? "断开 " + client.name + " 接入"
          : "开启 " + client.name + " 接入"
      }
      className="connection-switch"
      data-error={connection.syncError ? "true" : undefined}
      disabled={!!busy || state.connections.busy}
      onClick={() => onManage({ scope: client.id, enabled: !enabled, issue: connection.syncError, name: client.name })}
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
  const modelCount = Number.isInteger(connection.modelCount) && connection.modelCount > 0
    ? ` · ${connection.modelCount} 个模型`
    : "";
  const note = connection.syncError ? `未同步：${connection.syncError}` : connection.pending ? "供应商接入有变更，点击同步后生效。" :
    connection.enabled ? (connection.mode === "native"
      ? connection.runtimeStatus === "client-refresh-required"
        ? `已写入原生配置${modelCount} · 已打开页面需刷新`
        : `已写入原生配置${modelCount} · 客户端重新加载后生效`
      : client.id === "codex" ? "已接入 · 任务结束后重启客户端" : "已接入 · 新窗口生效") : "";
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
export function ConnectionDialog(props) {
  return props.request.quit ? <ExitDialog onClose={props.onClose} /> : <ConnectionChangeDialog {...props} />;
}
function ExitDialog({ onClose }) {
  const [status, setStatus] = useState(null), [plan, setPlan] = useState(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState("");
  useEffect(() => {
    let active = true;
    async function inspect() {
      try {
        const value = await api.call("app-exit-preview");
        if (!active) return;
        setStatus(value);
        if (value.error) { setError(value.error); return; }
        if (value.safeNeeded) {
          const safePlan = await api.call("connection-preview", "all", false, true);
          if (active) setPlan(safePlan);
        }
      } catch (e) {
        if (active) {
          setStatus(previous => previous || { safeNeeded: true });
          setError(cleanError(e));
        }
      }
    }
    inspect();
    return () => { active = false; };
  }, []);
  async function exit(mode) {
    if (busy || (mode === "safe" && !plan)) return;
    setBusy(mode);
    setError("");
    try {
      if (mode === "direct") await api.call("app-exit-direct", true);
      else await api.call("connection-apply", { ticket: plan.ticket, mode: "terminate", acknowledged: true });
    } catch (e) {
      setError(cleanError(e));
      if (mode === "safe") setPlan(null);
      setBusy("");
    }
  }
  return <Modal title="退出 ASS？" className="connection-confirm connection-exit"
    closeButton={false} dismissible={!busy} onClose={onClose}>
    <dl className="exit-options">
      <div><dt>直接退出</dt><dd id="exit-direct-description">保留所有接入与免登录配置，不关闭客户端窗口。路由请求会中断，依赖 ASS 的模型需重新启动 ASS 后才能继续使用。</dd></div>
      {status?.safeNeeded && <div><dt>安全退出</dt><dd id="exit-safe-description">撤回依赖 ASS 的注入后退出，官方账户、会话与原生直连配置保留。
        {plan?.sessions.length > 0 && <span>将关闭 {plan.sessions.length} 个由 ASS 启动的路由窗口。</span>}
        <span>请先结束客户端中的任务。</span></dd></div>}
    </dl>
    {status === null && <p className="connection-repair-note" role="status">正在检查是否需要安全退出…</p>}
    {status?.active > 0 && <p className="connection-repair-note" role="status">当前有 {status.active} 个路由请求；安全退出需等待请求结束。</p>}
    {error && <p className="connection-confirm-message exit-error" role="alert">{error}</p>}
    <footer>
      <button className="button" data-autofocus disabled={!!busy} onClick={onClose}>取消</button>
      {status?.safeNeeded && <button className="button" disabled={!!busy || !plan || plan.active > 0}
        aria-describedby="exit-safe-description" onClick={() => exit("safe")}>
        {busy === "safe" && <Loader2 size={14} className="spin" />}安全退出
      </button>}
      <button className="button primary" disabled={!!busy} aria-describedby="exit-direct-description" onClick={() => exit("direct")}>
        {busy === "direct" && <Loader2 size={14} className="spin" />}直接退出
      </button>
    </footer>
  </Modal>;
}
function ConnectionChangeDialog({ request, onClose, onComplete }) {
  const [plan, setPlan] = useState(null),
    [repair, setRepair] = useState(null),
    [repairReason, setRepairReason] = useState(""),
    [error, setError] = useState(""),
    [restart, setRestart] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setPlan(null);
    setRepair(null);
    setRepairReason("");
    setError("");
    setRestart(false);
    async function preview() {
      let failed = false;
      try {
        const value = await api.call("connection-preview", request.scope, request.enabled, false, request.accountless);
        if (active) setPlan(value);
      } catch (e) {
        failed = true;
        if (active) setError(cleanError(e));
      }
      if (active && request.accountless === undefined && (failed || request.issue) && request.scope !== "all") {
        try {
          const value = await api.call("connection-repair-preview", request.scope);
          if (active) setRepair(value);
        } catch (e) {
          if (active) setRepairReason(cleanError(e));
        }
      }
    }
    preview();
    return () => {
      active = false;
    };
  }, [request.scope, request.enabled, request.issue, request.accountless]);
  const target = plan?.names.join("、") || repair?.names.join("、") || request.name || "客户端";
  const hasIssue = request.accountless === undefined && request.scope !== "all" && (!!request.issue || !!error);
  const restartPlan = hasIssue ? repair?.restart : plan?.restart;
  const title = request.accountless !== undefined ? `${request.accountless ? "开启" : "关闭"} ${target} 无账号启动？` : hasIssue ? `${target} 接入异常` : request.scope === "all"
      ? "停止全部接入？"
      : request.enabled
        ? `${request.sync ? "同步" : "开启"} ${target} 接入？`
        : `断开 ${target} 接入？`;
  let warning = "正在检查接入状态…";
  if (plan) {
    if (request.accountless !== undefined) {
      warning = request.accountless ? request.scope === "claude"
        ? "终端和桌面版均使用注入模型；桌面版重新打开后选择 Continue with Gateway。按 API 计费，原有登录保留。"
        : "仅使用已注入模型，按供应商 API 计费。原有官方登录保留。"
        : "恢复正常账户启动；已有窗口需重启后生效。";
    } else if (plan.enabled) {
      warning = plan.codexConfig
        ? "将更新 Codex 接入配置，保留原有登录与会话。"
        : plan.native
          ? request.scope === "dsh"
            ? "将同步模型及凭据。DSH 后端会热加载，已打开页面仍需刷新。"
            : "将同步模型及其凭据。请先结束客户端任务；原有登录保留。"
          : `后续从 ASS 启动的 ${target} 将使用路由配置，不影响已有窗口。`;
    } else {
      const windows = plan.sessions.length
        ? `并关闭 ${plan.sessions.length} 个由 ASS 启动的窗口`
        : "";
      warning = `将恢复接口配置${windows}${plan.stopService ? "，停止路由服务" : ""}。${restart ? "请先结束任务。" : "请先结束任务，并退出自行启动的客户端。"}`;
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
  async function repairConnection() {
    if (!repair || busy) return;
    setBusy(true);
    try {
      const result = await api.call("connection-repair", { ticket: repair.ticket, acknowledged: true, restart });
      onComplete(result.message, result.restart?.ok === false);
      onClose();
    } catch (e) {
      setError(cleanError(e));
      setRepair(null);
      setRepairReason("请重新打开弹窗，检查最新配置后再修复。");
      setPlan(null);
    } finally { setBusy(false); }
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
        {error || request.issue || warning}
      </p>
      {hasIssue && <p className="connection-repair-note">
        {repair ? repair.migration ? "将备份并迁移到 DSH 当前 profile，不重启客户端。" : `将备份并恢复上次接入配置${repair.files ? `（${repair.files} 个文件）` : ""}。${restart ? "" : "不会关闭客户端；请先结束任务。"}` : repairReason || "正在检查可修复内容…"}
      </p>}
      {restartPlan?.applicable && <div className="connection-restart" data-force={restart || undefined}>
        <div className="connection-restart-choices" role="radiogroup" aria-label="配置生效方式">
          <label>
            <input type="radio" name="connection-restart" checked={!restart} disabled={busy}
              onChange={() => setRestart(false)} />
            <span><SlidersHorizontal size={16} />仅应用配置</span>
          </label>
          <label>
            <input type="radio" name="connection-restart" checked={restart} disabled={busy || !restartPlan.available}
              onChange={() => setRestart(true)} />
            <span><RotateCw size={16} />强制重启</span>
          </label>
        </div>
        <small>{restart ? `将强制关闭${restartPlan.names?.join("、") || target}及正在运行的任务，再重新打开。`
          : restartPlan.available ? "不关闭客户端；任务结束后手动重启生效。" : restartPlan.reason}</small>
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
        {(plan || !hasIssue) && <button
          className="button primary"
          disabled={!plan || busy || (restart && !plan.restart?.available)}
          onClick={commit}
        >
          {busy && <Loader2 size={14} className="spin" />}
          {hasIssue ? request.enabled ? "同步" : "断开接入" : "确定"}
        </button>}
        {hasIssue && <button className="button primary connection-repair" disabled={!repair || busy} onClick={repairConnection}>
          {busy ? <Loader2 size={14} className="spin" /> : <Wrench size={15} />}
          {busy ? "修复中…" : "一键修复"}
        </button>}
      </footer>
    </Modal>
  );
}
function cleanError(error) {
  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, "");
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
