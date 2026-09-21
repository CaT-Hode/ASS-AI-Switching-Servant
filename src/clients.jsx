import React, { useState } from "react";
import {
  Terminal,
  KeyRound,
  UserRound,
  Plus,
  Folder,
  LogIn,
  LogOut,
  Check,
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  Search,
} from "lucide-react";
import { Modal } from "./editors.jsx";
import { ConnectionSwitch, ConnectionService } from "./connections.jsx";
const api = window.ass;
export function AccountForm({ client, onClose, onSave, initialProvider = "" }) {
  const [label, setLabel] = useState(""),
    [provider, setProvider] = useState(initialProvider),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={"添加 " + client.name + " 授权账户"}
      description="使用独立原生配置目录，不导入或覆盖现有客户端的凭据。"
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(label, provider);
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          账户名称
          <input
            required
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如 个人账户 / 工作账户"
          />
        </label>
        {client.id === "pi" && (
          <label className="field">
            OAuth provider ID（可选）
            <input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="留空，在 pi 的 /login 中选择"
            />
            <small>
              支持本机 pi 原生及扩展的 OAuth。留空不限供应商；例如
              openai-codex、anthropic、github-copilot。ASS
              不实现或绕过供应商授权。
            </small>
          </label>
        )}
        <p className="hint">
          创建后点击“登录授权”，在原生客户端完成登录。凭据由该客户端保存和刷新，不会发回前端。
        </p>
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "正在创建…" : "创建账户"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function Clients({ state, act, busy, onManage, initialClient = "codex" }) {
  const [selected, setSelected] = useState(initialClient),
    [adding, setAdding] = useState(false),
    [candidates, setCandidates] = useState(null),
    [model, setModel] = useState("");
  const client = state.harnesses.clients.find((c) => c.id === selected),
    account = client.accounts.find((a) => a.id === client.selected);
  const models = account?.models || [],
    chosen = models.some((m) => m.model === model) ? model : models[0]?.model;
  const run = (action) =>
    act("client-" + action, async () => {
      const r = await api.call(
        "client-launch",
        client.id,
        account.id,
        action,
        chosen,
      );
      if (r?.message) setNotice(r.message);
      return r;
    });
  const [notice, setNotice] = useState("");
  const detect = () =>
    act("client-detect", async () => {
      const result = await api.call("client-detect", client.id);
      if (result.candidates.length > 1) setCandidates(result.candidates);
      else
        setNotice(
          result.candidates.length
            ? "已识别并选择客户端入口。"
            : "常见位置未找到可用入口，请点击“选择目录”定位安装或源码目录。",
        );
    });
  return (
    <>
      <div className="clients-intro">
        <ShieldCheck size={20} />
        <div>
          <strong>一个客户端，一套明确的账户</strong>
          <p>
            API 账户复用供应商配置，授权账户独立保存。选择只影响从 ASS
            新启动的客户端，不替换运行中的会话。
          </p>
        </div>
        <button
          className="button"
          onClick={() =>
            act("client-refresh", () => api.call("client-refresh"))
          }
        >
          <RefreshCw size={14} />
          刷新状态
        </button>
      </div>
      {state.connections.error && <p role="alert" className="error-box">{state.connections.error}</p>}
      <ConnectionService {...{ state, busy, onManage }} />
      <div className="clients-layout">
        <div className="client-list" aria-label="客户端列表">
          {state.harnesses.clients.map((c) => (
            <button
              key={c.id}
              className={c.id === selected ? "active" : ""}
              onClick={() => {
                setSelected(c.id);
                setModel("");
                setNotice("");
              }}
            >
              <Terminal size={19} />
              <span>
                <strong>{c.name}</strong>
                <small>{c.executable ? "已找到客户端" : "未检测到安装"}</small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
        <section className="client-panel">
          <header className="client-heading">
            <div>
              <h2>{client.name}</h2>
              <p>{client.description}</p>
            </div>
          </header>
          <ConnectionSwitch {...{ client, state, busy, onManage }} />
          <div className="client-location-actions" aria-label="客户端位置">
            <button className="button" disabled={!!busy} onClick={detect}>
              <Search size={14} />
              自动识别
            </button>
            <button
              className="button"
              disabled={!!busy}
              onClick={() =>
                act("client-directory", () =>
                  api.call("client-executable", client.id, true),
                )
              }
            >
              <Folder size={14} />
              选择目录
            </button>
            <button
              className="button"
              disabled={!!busy}
              onClick={() =>
                act("client-path", () =>
                  api.call("client-executable", client.id),
                )
              }
            >
              <Folder size={14} />
              选择文件
            </button>
          </div>
          <div className="client-location" role="status">
            <p
              className={
                "launcher-state " + (client.launcher?.ready ? "ready" : "")
              }
            >
              {client.launcher?.ready && <Check size={14} />}
              {client.launcher?.message || "未检测到安装"}
            </p>
            {client.launcher?.location && (
              <p className="client-path mono">{client.launcher.location}</p>
            )}
            {client.launcher?.ready && (
              <details className="launcher-command">
                <summary>查看启动入口</summary>
                <code>{client.launcher.command}</code>
              </details>
            )}
            <p className="hint">
              可直接选择 DSH
              源码目录，无需手写启动脚本。不会自动安装依赖或运行构建。
            </p>
          </div>
          <div className="section-heading">
            <h3>
              可用账户 <span className="count">{client.accounts.length}</span>
            </h3>
            {client.oauth && (
              <button className="text-button" onClick={() => setAdding(true)}>
                <Plus size={14} />
                添加授权账户
              </button>
            )}
          </div>
          <div className="account-list">
            {!client.accounts.length && (
              <div className="empty">
                <KeyRound size={22} />
                <p>
                  {client.id === "dsh"
                    ? "添加 DeepSeek API 供应商后，会自动出现在这里。"
                    : "添加 API 供应商或授权账户，即可选择并启动。"}
                </p>
              </div>
            )}
            {client.accounts.map((a) => (
              <button
                className={
                  "account-row " + (a.id === account?.id ? "selected" : "")
                }
                key={a.id}
                onClick={() =>
                  act("account-select", () =>
                    api.call("account-select", client.id, a.id),
                  )
                }
              >
                <span className="account-symbol">
                  {a.kind === "api" ? (
                    <KeyRound size={18} />
                  ) : (
                    <UserRound size={18} />
                  )}
                </span>
                <span className="account-content">
                  <strong>
                    {a.label}
                    <span className="tag">{a.badge}</span>
                  </strong>
                  <small>
                    {a.message}
                    {a.providers?.length ? " · " + a.providers.join(", ") : ""}
                  </small>
                </span>
                {a.id === account?.id ? (
                  <Check size={18} />
                ) : (
                  <span className="account-unselected" />
                )}
              </button>
            ))}
          </div>
          {client.id === "pi" && (
            <div className="pi-import">
              <div className="section-heading">
                <h3>从其他客户端导入 OAuth</h3>
                <span className="tag">新建独立账户</span>
              </div>
              <p className="hint">
                {state.harnesses.piOAuthProviders.length
                  ? "本机 pi 已确认：" +
                    state.harnesses.piOAuthProviders
                      .map((p) => p.name)
                      .join("、")
                  : "尚未确认本机 pi 的 OAuth 能力。请选择 pi 的 npm 启动程序并刷新；独立二进制仍可使用原生 /login。"}
              </p>
              {!state.harnesses.oauthSources.length ? (
                <p className="hint">
                  未发现可转换的 Codex / Claude / OpenCode
                  授权。请先在来源客户端登录。
                </p>
              ) : (
                state.harnesses.oauthSources.map((s) => (
                  <div className="oauth-source" key={s.id}>
                    <div>
                      <strong>{s.label}</strong>
                      <small>
                        {s.provider} ·{" "}
                        {s.expired ? "已到期，需原生刷新" : "本地授权快照"}
                      </small>
                    </div>
                    <button
                      className="button"
                      disabled={!s.compatible || !!busy}
                      onClick={() =>
                        act("pi-import", () =>
                          api.call("pi-import-oauth", s.id, s.label + " → pi"),
                        )
                      }
                    >
                      {s.compatible ? "导入到 pi" : "未确认兼容"}
                    </button>
                  </div>
                ))
              )}
              <p className="hint">
                不覆盖来源。两端会独立刷新令牌；授权权益与实际可用性以供应商为准。
              </p>
            </div>
          )}
          {account && (
            <div className="client-launch">
              <div className="section-heading">
                <div>
                  <h3>启动配置</h3>
                  <p className="hint">当前选择：{account.label}</p>
                </div>
                {account.kind === "auth" && (
                  <div className="actions">
                    <button
                      className="button"
                      disabled={!client.executable || !!busy}
                      onClick={() => run("login")}
                    >
                      <LogIn size={14} />
                      登录授权
                    </button>
                    <button
                      className="text-button danger"
                      disabled={!client.executable || !!busy}
                      onClick={() => run("logout")}
                    >
                      <LogOut size={14} />
                      退出授权
                    </button>
                  </div>
                )}
              </div>
              {account.kind === "api" && (
                <label className="field">
                  本次使用模型
                  <select
                    value={chosen || ""}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={!models.length}
                  >
                    {!models.length && <option value="">没有兼容模型</option>}
                    {models.map((m) => (
                      <option key={m.model} value={m.model}>
                        {m.name} · {m.protocol}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="client-workspace">
                <Folder size={15} />
                <span className="ellipsis" title={state.harnesses.workspace}>
                  {state.harnesses.workspace || "ASS 独立工作目录（可更改）"}
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    act("client-workspace", () => api.call("client-workspace"))
                  }
                >
                  选择目录
                </button>
              </div>
              <button
                className="button primary launch-button"
                disabled={
                  !client.executable ||
                  !!busy ||
                  (account.kind === "api" && !models.length)
                  || (account.kind === "api" && !state.connections.clients[client.id].enabled)
                }
                onClick={() => run("launch")}
              >
                <Terminal size={16} />
                使用此账户启动 {client.name}
              </button>
            </div>
          )}
          {notice && (
            <p className="client-notice" role="status">
              {notice}
            </p>
          )}
          <div className="client-footnote">
            <ShieldCheck size={14} />
            <span>
              原始客户端配置保持不变。API 密钥由 ASS
              加密保存；授权凭据按原生客户端方式保存，目录位于当前 Windows
              用户下。ASS 重启后，请重新启动经路由的客户端。
            </span>
          </div>
        </section>
      </div>
      {adding && (
        <AccountForm
          client={client}
          onClose={() => setAdding(false)}
          onSave={async (label, provider) => {
            await api.call("account-add", client.id, label, provider);
            await act("account-refresh", () => api.call("snapshot"));
          }}
        />
      )}
      {candidates && (
        <Modal
          title="选择识别到的客户端"
          description="检测到多套入口，请选择本次要使用的位置。"
          onClose={() => setCandidates(null)}
        >
          <div className="launcher-candidates">
            {candidates.map((candidate) => (
              <button
                className="account-row"
                key={candidate.location}
                disabled={!!busy}
                onClick={() =>
                  act("client-location", async () => {
                    await api.call(
                      "client-location",
                      client.id,
                      candidate.location,
                    );
                    setCandidates(null);
                    setNotice("已选择客户端入口。");
                  })
                }
              >
                <Folder size={18} />
                <span className="account-content">
                  <strong>{candidate.message}</strong>
                  <small>{candidate.location}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
