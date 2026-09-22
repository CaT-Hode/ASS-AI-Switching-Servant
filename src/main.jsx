import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Network,
  LayoutGrid,
  Boxes,
  Activity,
  ShieldCheck,
  Upload,
  ChevronRight,
  Settings2,
  X,
  Download,
  Folder,
  Monitor,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Play,
  Square,
} from "lucide-react";
import "./style.css";
import "./controls.css";
import "./polish.css";
import "./clients.css";
import "./sidebar.css";
import { Clients } from "./clients.jsx";
import { ConnectionDialog } from "./connections.jsx";
import { Providers } from "./providers.jsx";
import { Updates, UpdateBanner } from "./updates.jsx";
import { modelKey, ModelCheckButton } from "./model-inspection.jsx";
import { DiagnosticTime } from "./diagnostic-time.jsx";
const api = window.ass;
const protocols = {
  "openai-responses": "Responses",
  "openai-chat": "Chat Completions",
  anthropic: "Anthropic Messages",
};
const date = (value) =>
  new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
function Button({
  children,
  primary = false,
  icon: Icon,
  busy = false,
  ...props
}) {
  return (
    <button
      className={"button" + (primary ? " primary" : "")}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy ? (
        <Loader2 className="spin" size={16} />
      ) : Icon ? (
        <Icon size={16} />
      ) : null}
      {children}
    </button>
  );
}
function ProviderIcon({ p }) {
  return (
    <span
      className={"provider-icon " + (p.id === "official" ? "official" : "")}
    >
      <span>
        {p.id === "official" ? (
          <Network size={23} />
        ) : (
          p.name.slice(0, 1).toUpperCase()
        )}
      </span>
    </span>
  );
}
function RequestTable({ rows }) {
  return (
    <div className="request-table">
      <div className="table-head request-row">
        <span>时间</span>
        <span>模型</span>
        <span>来源</span>
        <span>状态</span>
        <span>耗时</span>
      </div>
      {!rows.length ? (
        <div className="empty">
          <Activity size={26} />
          <p>等待第一个请求</p>
          <small>连接检测或 Codex 请求会显示在这里，不记录对话内容。</small>
        </div>
      ) : (
        rows.slice(0, 8).map((r, i) => (
          <div className="request-row" key={r.time + i}>
            <span className="muted mono">{date(r.time)}</span>
            <span className="ellipsis" title={r.model}>
              {r.model.split("::").at(-1)}
            </span>
            <span className="muted">{r.source}</span>
            <span className={r.ok ? "success" : "danger"} title={r.error}>
              {r.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{" "}
              {r.ok ? "成功" : r.status}
            </span>
            <span className="muted mono">{(r.ms / 1000).toFixed(2)} s</span>
          </div>
        ))
      )}
    </div>
  );
}
function Overview({ state, providers, act, busy, setView, openProvider }) {
  return (
    <>
      <div className="overview-grid">
        <section>
          <div className="section-heading">
            <h2>模型来源</h2>
            <button
              className="text-button"
              onClick={() => setView("providers")}
            >
              管理模型 <ChevronRight size={14} />
            </button>
          </div>
          <div className="source-table">
            <div className="source-row table-head">
              <span>来源</span>
              <span>协议</span>
              <span>模型</span>
              <span>操作</span>
            </div>
            {providers.map((p) => (
              <div className="source-row" key={p.id}>
                <div className="source-name">
                  <ProviderIcon p={p} />
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {
                        p.models.filter(
                          (m) => state.diagnostics[modelKey(p.id, m.model)]?.ok,
                        ).length
                      }{" "}
                      / {p.models.length} 个模型连接已验证
                    </small>
                  </div>
                </div>
                <span className="muted">
                  {new Set(p.models.map((m) => m.wireApi)).size > 1
                    ? "混合协议"
                    : protocols[p.models[0]?.wireApi] ||
                      protocols[p.wireApi] ||
                      "Responses"}
                </span>
                <span className="muted">{p.models.length} 个模型</span>
                <Button icon={ChevronRight} onClick={() => openProvider(p.id)}>
                  查看模型
                </Button>
              </div>
            ))}
          </div>
        </section>
        <aside className="security-panel">
          <h2>安全连接</h2>
          <div className="trust">
            <ShieldCheck size={43} />
            <div>
              <h3>Windows 系统证书</h3>
              <p>使用系统信任的 CA，保留 TLS 校验。</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>凭据存储</dt>
              <dd>
                {state.encrypted ? (
                  <>
                    <CheckCircle2 size={15} /> Windows 加密
                  </>
                ) : (
                  "加密不可用"
                )}
              </dd>
            </div>
            <div>
              <dt>窗口关闭后</dt>
              <dd>
                <CheckCircle2 size={15} /> 托盘运行
              </dd>
            </div>
          </dl>
          <label className="check-field small">
            <input
              type="checkbox"
              checked={state.autoStart}
              onChange={(e) =>
                act("auto", () => api.call("autostart", e.target.checked))
              }
            />
            登录 Windows 时启动
          </label>
        </aside>
      </div>
      <section className="recent-section">
        <div className="section-heading">
          <h2>最近请求</h2>
          <span className="muted tiny">仅记录模型、状态与耗时</span>
        </div>
        <RequestTable rows={state.recent} />
      </section>
      <footer className="page-footer">
        模型设置修改后，重新启动相应客户端以加载配置。
      </footer>
    </>
  );
}
function Diagnostics({ state, providers, act, busy }) {
  const batch = state.diagnosticBatch;
  const results = new Map((batch?.entries || []).map((e) => [e.key, e]));
  const available = providers.flatMap((p) =>
    p.enabled !== false && (p.id === "official" ? state.authReady : p.hasKey)
      ? p.models.filter((m) => m.enabled !== false)
      : [],
  ).length;
  return (
    <>
      <div className="diagnostic-toolbar">
        <div>
          <h2>
            模型连接测试 <span className="count">{available}</span>
          </h2>
          <p className="muted">
            每个已启用模型发送一条小请求，检查完整响应；可能计费。最多同时测试 2
            个。
          </p>
        </div>
        {batch?.running ? (
          <Button
            icon={Square}
            disabled={batch.stopping}
            onClick={() =>
              act("diag-cancel", () => api.call("diagnose-cancel"))
            }
          >
            {batch.stopping ? "正在取消…" : "取消测试"}
          </Button>
        ) : (
          <Button
            icon={Play}
            primary
            disabled={!!busy || !available || state.connections.busy}
            onClick={() => act("diag-all", () => api.call("diagnose-all"))}
          >
            一键测试
          </Button>
        )}
      </div>
      {state.diagnosticHistoryError && (
        <p className="danger" role="alert">
          {state.diagnosticHistoryError}
        </p>
      )}
      {!!batch?.entries.length && (
        <div className="diagnostic-progress" role="status" aria-live="polite">
          <div>
            <strong>
              {batch.running
                ? "测试中"
                : batch.cancelled
                  ? "测试已取消"
                  : "测试完成"}{" "}
              · {batch.completed} / {batch.total}
            </strong>
            <span>
              通过 {batch.passed} · 失败 {batch.failed} · 跳过 {batch.skipped}
              {batch.cancelled ? " · 取消 " + batch.cancelled : ""}
            </span>
          </div>
          <progress
            aria-label="一键测试进度"
            value={batch.completed}
            max={batch.total || 1}
          />
        </div>
      )}
      <div className="diagnostic-list">
        {providers.flatMap((p) =>
          p.models.map((m) => {
            const d = state.diagnostics[modelKey(p.id, m.model)];
            const entry = results.get(modelKey(p.id, m.model));
            const run =
              batch?.running ||
              !d ||
              !batch?.finishedAt ||
              d.time <= batch.finishedAt
                ? entry
                : null;
            const showResult =
              d && (!run || ["passed", "failed"].includes(run.status));
            return (
              <div className="diagnostic" key={modelKey(p.id, m.model)}>
                <ProviderIcon p={p} />
                <div className="diagnostic-content">
                  <h3>
                    {p.name} / {m.displayName}
                  </h3>
                  <p
                    className={
                      (run ? run.status === "failed" : d && !d.ok)
                        ? "danger"
                        : "muted"
                    }
                  >
                    {run?.message || d?.message || "尚未执行连接检测"}
                  </p>
                  {d && (
                    <small>
                      {showResult
                        ? `${d.model} · ${(d.ms / 1000).toFixed(2)} s · `
                        : ""}
                      <DiagnosticTime result={d} />
                    </small>
                  )}
                </div>
                <ModelCheckButton
                  provider={p}
                  model={m}
                  {...{ state, act, busy }}
                />
              </div>
            );
          }),
        )}
      </div>
      <div className="diagnostic-settings">
        <h2>本机状态</h2>
        <dl>
          <div>
            <dt>路由入口</dt>
            <dd className="mono">
              http://127.0.0.1:{state.service.port}/clients/codex/v1
            </dd>
          </div>
          <div>
            <dt>Codex 接入</dt>
            <dd>{state.codex.attached ? "已接入 ASS" : "未接入"}</dd>
          </div>
          <div>
            <dt>TLS 校验</dt>
            <dd>已开启 · Chromium 系统网络栈</dd>
          </div>
          <div>
            <dt>数据目录</dt>
            <dd className="ellipsis" title={state.dataDir}>
              {state.dataDir}
            </dd>
          </div>
        </dl>
        <div className="actions">
          <Button
            icon={Folder}
            onClick={() => act("data", () => api.call("open-data"))}
          >
            打开数据目录
          </Button>
          <Button
            icon={Download}
            onClick={() => act("export", () => api.call("export"))}
          >
            导出配置（无密钥）
          </Button>
        </div>
      </div>
      <section className="recent-section">
        <h2>最近请求</h2>
        <RequestTable rows={state.recent} />
      </section>
    </>
  );
}
function App() {
  const [state, setState] = useState(null),
    [view, setViewLocal] = useState("overview"),
    [clientTarget, setClientTargetLocal] = useState("codex"),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState(null);
  const [connectionRequest, setConnectionRequest] = useState(null);
  const [providerDetail, setProviderDetail] = useState(null);
  function remember(input) {
    api
      .call("ui-preferences", input)
      .catch((e) =>
        setToast({ error: true, message: "设置保存失败：" + e.message }),
      );
  }
  function setView(next) {
    setProviderDetail(null);
    setViewLocal(next);
    remember({ view: next });
  }
  function setClientTarget(next) {
    setClientTargetLocal(next);
    remember({ client: next });
  }
  function setProviderTarget(next) {
    remember({ provider: next });
  }
  function openProvider(id) {
    setProviderTarget(id);
    setView("providers");
    setProviderDetail(id);
  }
  useEffect(
    () =>
      api?.onManage((request) => {
        setView("clients");
        setConnectionRequest((previous) => previous || request);
      }),
    [],
  );
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);
  useEffect(() => {
    if (!api) return;
    api
      .call("snapshot")
      .then((next) => {
        setState(next);
        setViewLocal(next.preferences.view);
        setClientTargetLocal(next.preferences.client);
      })
      .catch((e) => setToast({ error: true, message: e.message }));
    return api.subscribe(setState);
  }, []);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(null), 7000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  async function act(key, fn, success) {
    setBusy(key);
    try {
      const r = await fn();
      if (r?.ok === false) setToast({ error: true, message: r.message });
      else if (success) setToast({ message: success });
      else if (key === "import" && r)
        setToast({
          message: `已导入 ${r.providers} 个供应商、${r.models} 个模型`,
        });
      setState(await api.call("snapshot"));
      return r;
    } catch (e) {
      setToast({
        error: true,
        message: e.message.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      });
    } finally {
      setBusy("");
    }
  }
  if (!api)
    return (
      <div className="loading">
        <Monitor size={32} />
        <h2>请从 ASS 桌面应用打开</h2>
        <p>此界面通过本机桌面通道管理路由，不提供网页管理入口。</p>
      </div>
    );
  if (!state)
    return (
      <div className="loading">
        <Loader2 className="spin" />
        <p>正在加载本机路由…</p>
      </div>
    );
  const providers = [
    {
      id: "official",
      name: "OpenAI 官方",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      models: state.officialModels,
    },
    ...state.providers,
  ];
  const title = {
    overview: "路由总览",
    providers: "供应商与模型",
    clients: "客户端与账户",
    diagnostics: "连接诊断",
    updates: "关于 ASS",
  }[view];
  return (
    <div
      className="app-shell"
      data-input="keyboard"
      onPointerDownCapture={(e) => {
        e.currentTarget.dataset.input = "pointer";
      }}
      onPointerMoveCapture={(e) => {
        if (e.pointerType === "mouse")
          e.currentTarget.dataset.input = "pointer";
      }}
      onKeyDownCapture={(e) => {
        e.currentTarget.dataset.input = "keyboard";
      }}
    >
      <aside className="sidebar">
        <div className="brand">
          <img src="./ass-logo.png" alt="ASS 菊花标志" />
          <div>
            <strong>ASS</strong>
            <small>AI 路由</small>
          </div>
        </div>
        <div className="nav-label">工作空间</div>
        <nav aria-label="主导航">
          {[
            ["overview", LayoutGrid, "路由总览"],
            ["providers", Boxes, "供应商与模型"],
            ["clients", Monitor, "客户端与账户"],
            ["diagnostics", Activity, "连接诊断"],
            ["updates", Download, "关于 ASS"],
          ].map(([id, Icon, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              <Icon size={21} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <section
            className={
              "sidebar-service" + (!state.service.running ? " stopped" : "")
            }
            aria-label="路由服务状态"
          >
            <div className="sidebar-service-heading" role="status">
              <span className="status-dot" aria-hidden="true" />
              <strong>
                {state.service.running ? "路由服务已就绪" : "路由服务已停止"}
              </strong>
            </div>
            <span className="mono">127.0.0.1:{state.service.port}</span>
            <small>
              {state.service.running
                ? "HTTP · 本机路由"
                : "当前请求无法经由 ASS 转发"}
            </small>
            <Button icon={Settings2} onClick={() => setView("clients")}>
              管理客户端接入
            </Button>
          </section>
        </div>
        <button
          className="version version-button"
          aria-label="查看 ASS 版本与更新"
          onClick={() => setView("updates")}
        >
          {state.updates.available && <span className="update-dot" />}v
          {state.version}
          {state.updates.available ? " · 发现新版" : " · 检查更新"}
        </button>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <h1>{title}</h1>
          </div>
          <div className="actions">
            <Button
              icon={Upload}
              busy={busy === "import"}
              onClick={() => act("import", () => api.call("import"))}
            >
              导入配置
            </Button>
          </div>
        </header>
        {state.startupError && (
          <div className="error-box">{state.startupError}</div>
        )}
        {view !== "updates" && (
          <UpdateBanner
            updates={state.updates}
            act={act}
            onView={() => setView("updates")}
          />
        )}
        {view === "overview" ? (
          <Overview
            {...{ state, providers, act, busy, setView, openProvider }}
          />
        ) : view === "providers" ? (
          <Providers
            {...{ state, providers, act, busy }}
            activeProvider={providerDetail}
            onOpenProvider={(id) => {
              setProviderTarget(id);
              setProviderDetail(id);
            }}
            onBack={() => setProviderDetail(null)}
          />
        ) : view === "clients" ? (
          <Clients
            {...{ state, act, busy }}
            onManage={setConnectionRequest}
            initialClient={clientTarget}
            onSelectClient={setClientTarget}
            openProvider={openProvider}
          />
        ) : view === "updates" ? (
          <Updates {...{ state, act, busy }} />
        ) : (
          <Diagnostics {...{ state, providers, act, busy }} />
        )}
      </main>
      {connectionRequest && (
        <ConnectionDialog
          request={connectionRequest}
          onClose={() => setConnectionRequest(null)}
          onComplete={(message) => {
            setToast({ message });
            api
              .call("snapshot")
              .then(setState)
              .catch(() => {});
          }}
        />
      )}
      {toast && (
        <div role="status" className={"toast " + (toast.error ? "error" : "")}>
          {toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="关闭通知">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
