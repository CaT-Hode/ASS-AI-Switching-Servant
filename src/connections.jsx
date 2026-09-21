import React, { useEffect, useState } from "react";
import { ShieldCheck, ChevronRight, AlertTriangle, Power, Loader2, Terminal } from "lucide-react";
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
      onClick={() => onManage({ scope: client.id, enabled: false })}>断开与关闭选项 <ChevronRight size={14} /></button>
  </section>;
}
export function ConnectionDialog({ request, onClose, onComplete }) {
  const [plan, setPlan] = useState(null), [step, setStep] = useState(1), [mode, setMode] = useState("safe");
  const [ack, setAck] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setPlan(null); setError(""); setStep(1); setAck(false);
    api.call("connection-preview", request.scope, request.enabled, !!request.quit)
      .then((p) => { if (active) setPlan(p); })
      .catch((e) => { if (active) setError(e.message.replace(/^Error invoking remote method '[^']+': Error: /, "")); });
    return () => { active = false; };
  }, [request.scope, request.enabled, request.quit, reload]);
  const label = request.quit ? "退出 ASS" : request.enabled ? "开启接入" : "断开接入";
  async function commit() {
    setBusy(true); setError("");
    try {
      const result = await api.call("connection-apply", { ticket: plan.ticket, mode, acknowledged: ack });
      onComplete(result.message); onClose();
    } catch (e) {
      setError(e.message.replace(/^Error invoking remote method '[^']+': Error: /, ""));
      setPlan(null); setStep(1); setAck(false);
    } finally { setBusy(false); }
  }
  return <Modal title={(step === 1 ? "接入选项 · " : "确认影响 · ") + label}
    description="先查看范围，再确认执行。取消或 Escape 不会更改接入。" dismissible={!busy} onClose={onClose}>
    <div className="connection-steps" aria-label="确认进度"><span className={step === 1 ? "current" : ""}>1 选择操作</span><ChevronRight size={14} /><span className={step === 2 ? "current" : ""}>2 确认影响</span></div>
    {!plan && !error && <p className="hint"><Loader2 size={16} className="spin" /> 正在读取配置与登记窗口身份…</p>}
    {error && <div className="error-box" role="alert">{error}<p><button className="button" disabled={busy} onClick={() => setReload((n) => n + 1)}>重新检查</button></p></div>}
    {plan && <>
      <div className="connection-target"><strong>{plan.names.join("、")}</strong>
        <small>{plan.enabled ? "开启本地接口与后续启动注入" : plan.stopService ? "恢复所选注入；最后一个接入关闭后停止本地服务" : "只关闭所选接入；其他客户端继续使用共享服务"}</small></div>
      {step === 1 ? <>
        {!plan.enabled && <fieldset className="connection-options"><legend>如何处理已启动窗口</legend>
          <label className={mode === "safe" ? "selected" : ""}><input type="radio" name="disconnect-mode" checked={mode === "safe"} onChange={() => setMode("safe")} /><span><strong>安全断开 · 先自行退出客户端</strong><small>默认选项。登记窗口或请求仍在运行时拒绝断开，不代替你结束任务。</small></span></label>
          <label className={mode === "terminate" ? "selected danger-choice" : ""}><input type="radio" name="disconnect-mode" checked={mode === "terminate"} onChange={() => setMode("terminate")} /><span><strong>结束 ASS 启动的窗口，然后断开</strong><small>将结束清单内窗口及其子进程，可能中断工具或未完成任务；不会关闭其他来源的窗口。</small></span></label>
        </fieldset>}
        <div className="connection-warning"><AlertTriangle size={18} /><p>请求数为 0 不代表任务完成：客户端可能正在运行工具或等待输入。ASS 无法判断未托管窗口的任务状态，也不会自动重启 Codex App。</p></div>
        <div className="connection-counts"><span>进行中请求 <b>{plan.active}</b></span><span>登记窗口 <b>{plan.sessions.length}</b></span></div>
        <footer><button className="button" onClick={onClose}>取消</button><button className="button primary" onClick={() => { setStep(2); setAck(false); }}>继续查看影响 <ChevronRight size={14} /></button></footer>
      </> : <>
        <ul className="connection-effects">
          {plan.codexConfig && <li>Codex 配置：{plan.enabled ? "备份并写入 ASS 接入区段" : "只恢复 ASS 管理区段，保留其他设置"}<code>{plan.codexConfig}</code></li>}
          <li>{plan.enabled ? "API 注入在下次从 ASS 启动时生成" : `恢复或移除 ${plan.files.length} 个已登记的注入文件；保留账户凭据、会话与工作目录`}</li>
          {!plan.enabled && <li>{plan.stopService ? "关闭本机共享路由端口" : `共享路由保留给：${plan.retained.join("、")}`}</li>}
          {plan.quit && <li>完成后退出 ASS，不自动重启其他客户端</li>}
        </ul>
        {plan.sessions.length > 0 && <div className="connection-session-list" aria-label="受影响窗口">{plan.sessions.map((s) => <div key={s.id}><Terminal size={15} /><span>{s.label}</span><code>PID {s.pid}</code><small>{s.status === "running" ? "身份已核验" : "身份未确认"}</small></div>)}</div>}
        {plan.processError && <p className="error-box">进程检查异常：{plan.processError}。关闭操作将被阻止。</p>}
        {!plan.enabled && mode === "terminate" && <p className="error-box">将终止上述 ASS 窗口及其子进程。此操作无法恢复未保存的任务进度。</p>}
        <label className="connection-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} /><span>{plan.enabled
          ? "我已检查影响范围，将在任务结束后自行重启需要生效的客户端。"
          : "我已确认任务可以结束，并手动退出未登记的客户端；了解此次操作的影响。"}</span></label>
        <footer><button className="button" disabled={busy} onClick={() => { setStep(1); setAck(false); }}>返回选项</button><button className="button" disabled={busy} onClick={onClose}>取消</button><button className={"button " + (!plan.enabled && mode === "terminate" ? "danger-solid" : "primary")} disabled={!ack || busy} onClick={commit}>{busy && <Loader2 size={14} className="spin" />}{busy ? "正在执行…" : "确认" + label}</button></footer>
      </>}
    </>}
  </Modal>;
}
export function ConnectionService({ state, onManage, busy }) {
  return <div className="connection-service"><div><strong>服务与接入管理</strong><p>停止全部会恢复五种客户端的注入；关闭前再次核对任务与窗口。</p></div><button className="button" disabled={busy || state.connections.busy} onClick={() => onManage({ scope: "all", enabled: false })}><Power size={15} />停止全部接入与服务…</button></div>;
}
