import React, { useEffect, useState } from "react";
import {
  Zap,
  ScanSearch,
  Settings2,
  Loader2,
  RefreshCw,
  Square,
  Plus,
  Search,
  Check,
} from "lucide-react";
import { Modal } from "./editors.jsx";
import "./model-inspection.css";
const api = window.ass;
export const modelKey = (provider, model) => JSON.stringify([provider, model]);
const statusText = {
  passed: "实测通过",
  observed: "已观察到有效调用",
  validated: "参数接受 · 非法值被拒",
  "accepted-unverified": "接受但未确认生效",
  rejected: "此次请求被拒",
  unknown: "未知 / 未验证",
};
const declaration = (v) =>
  v === true ? "声明支持" : v === false ? "声明不支持" : "未声明";
export function ModelCheckButton({ provider, model, state, act, busy }) {
  const key = modelKey(provider.id, model.model),
    result = state.diagnostics[key];
  const running = busy === "diag-" + key;
  return (
    <button
      type="button"
      className={
        "model-icon check-model " +
        (result ? (result.ok ? "passed" : "failed") : "")
      }
      aria-label={"检测模型 " + model.model}
      title={
        result
          ? result.message + " · 点击重新检测"
          : "检测此模型连接（小请求，可能计费）"
      }
      disabled={!!busy || model.enabled === false || provider.enabled === false}
      onClick={() =>
        act("diag-" + key, () => api.call("diagnose", provider.id, model.model))
      }
    >
      {running ? <Loader2 size={17} className="spin" /> : <Zap size={17} />}
    </button>
  );
}
export function ModelActions(props) {
  return (
    <div className="model-actions">
      <ModelCheckButton {...props} />
      <button
        className="model-icon"
        aria-label={"查看模型能力 " + props.model.model}
        title="查看声明与能力实测"
        disabled={!!props.busy}
        onClick={props.onInspect}
      >
        <ScanSearch size={17} />
      </button>
      <button
        className="model-icon"
        aria-label={"编辑模型 " + props.model.model}
        title="编辑模型配置"
        onClick={props.onEdit}
      >
        <Settings2 size={17} />
      </button>
    </div>
  );
}
function Declared({ value = {} }) {
  return (
    <dl className="capability-facts">
      <div>
        <dt>上下文上限</dt>
        <dd>{value.contextWindow?.toLocaleString() || "未声明"}</dd>
      </div>
      <div>
        <dt>最大输出</dt>
        <dd>{value.maxOutputTokens?.toLocaleString() || "未声明"}</dd>
      </div>
      <div>
        <dt>输入类型</dt>
        <dd>{value.inputModalities?.join(" / ") || "未声明"}</dd>
      </div>
      <div>
        <dt>工具调用</dt>
        <dd>{declaration(value.tools)}</dd>
      </div>
      <div>
        <dt>思维能力</dt>
        <dd>{declaration(value.reasoning)}</dd>
      </div>
      <div>
        <dt>思维档位</dt>
        <dd>{value.efforts?.join(" / ") || "未声明"}</dd>
      </div>
    </dl>
  );
}
export function ModelCapabilityDialog({
  provider,
  model,
  state,
  act,
  busy,
  onClose,
}) {
  const key = modelKey(provider.id, model.model),
    directory = state.providerModels?.[provider.id];
  const declared = directory?.models.find(
    (m) => m.model === model.model,
  )?.declared;
  const report = state.capabilities?.[key],
    progress = state.capabilityJobs?.[key];
  return (
    <Modal
      title={"模型能力 · " + model.displayName}
      description={provider.name + " / " + model.model}
      onClose={onClose}
    >
      <section className="capability-section">
        <div className="section-heading">
          <h3>接口声明</h3>
          <button
            className="button"
            disabled={!!busy}
            onClick={() =>
              act("metadata-" + provider.id, () =>
                api.call("models-discover", provider.id, true),
              )
            }
          >
            <RefreshCw size={14} />
            读取元数据
          </button>
        </div>
        <p className="hint">
          {directory?.error ||
            directory?.source ||
            "尚未读取；缺少字段不代表不支持。"}
        </p>
        <Declared value={declared} />
      </section>
      <section className="capability-section">
        <div className="section-heading">
          <h3>上游小请求实测</h3>
          {progress ? (
            <button
              className="button"
              onClick={() =>
                api.call("capabilities-cancel", provider.id, model.model)
              }
            >
              <Square size={14} />
              取消检测
            </button>
          ) : (
            <button
              className="button primary"
              disabled={
                !!busy || provider.id === "official" || model.enabled === false
              }
              onClick={() =>
                act("probe-" + key, () =>
                  api.call("capabilities-probe", provider.id, model.model),
                )
              }
            >
              <ScanSearch size={14} />
              自动检测能力
            </button>
          )}
        </div>
        {progress && (
          <p className="probe-progress" role="status">
            <Loader2 size={15} className="spin" />
            {progress}
          </p>
        )}
        {provider.id === "official" && (
          <p className="hint">
            订阅账户读取 Codex 本机能力声明；使用模型右侧闪电验证实际连接。通用
            API 能力探测不套用到订阅端点。
          </p>
        )}
        {report ? (
          <div className="probe-results">
            {Object.entries(report.protocols).map(([protocol, result]) => (
              <div key={protocol}>
                <span>{protocol}</span>
                <strong>
                  {statusText[result.status]}
                  {result.httpStatus ? " · HTTP " + result.httpStatus : ""}
                </strong>
              </div>
            ))}
            <div>
              <span>工具调用</span>
              <strong>{statusText[report.tools.status]}</strong>
            </div>
            {Object.entries(report.efforts).map(([effort, result]) => (
              <div key={effort}>
                <span>思维 · {effort}</span>
                <strong>
                  {statusText[result.status]}
                  {result.reasoningObserved ? " · 观察到推理输出" : ""}
                </strong>
              </div>
            ))}
            <p className="hint">
              {report.requestCount} 条请求 ·{" "}
              {new Date(report.time).toLocaleTimeString()}
              {report.cancelled ? " · 已取消，仅保留部分结果" : ""}
            </p>
          </div>
        ) : (
          <p className="hint">
            检测协议、工具结构及已配置思维档位，并加入非法参数对照。HTTP 200
            本身不代表能力有效。
          </p>
        )}
      </section>
      <p className="capability-warning">
        不会修改配置或执行工具。上下文上限、图像 / 音频 /
        视频输入只显示明确声明，不进行大请求盲测。原生 API 能力不等同于 Codex
        跨协议工具兼容性。结果保留在本次应用会话中。
      </p>
    </Modal>
  );
}
export function ProviderModelCatalog({ provider, state, act, busy }) {
  const available = provider.hasKey || provider.id === "official";
  const directory = state.providerModels?.[provider.id];
  const loading = !!state.modelDirectoryJobs?.[provider.id];
  const revision = state.modelDirectoryRevisions?.[provider.id] || 0;
  const [search, setSearch] = useState(""),
    [onlyNew, setOnlyNew] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    if (available)
      api.call("models-discover", provider.id).catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [provider.id, available, revision]);
  const configured = new Set(provider.models.map((m) => m.model));
  const models = (directory?.models || []).filter(
    (m) =>
      (!onlyNew || !configured.has(m.model)) &&
      `${m.model} ${m.displayName}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const issue = error || directory?.error;
  async function refresh() {
    setError("");
    try {
      await api.call("models-discover", provider.id, true);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section
      className="provider-model-catalog"
      aria-label={provider.name + " 可用模型"}
      aria-busy={loading}
    >
      <div className="section-heading">
        <div>
          <h2>
            供应商可用模型{" "}
            <span className="count">{directory?.models.length || 0}</span>
          </h2>
          <p className="catalog-caption">
            自动读取当前供应商目录，选择需要的模型加入配置。
          </p>
        </div>
        <button
          className="button"
          disabled={loading || !available}
          onClick={refresh}
        >
          {loading ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {loading ? "正在读取…" : "刷新模型列表"}
        </button>
      </div>
      {!available ? (
        <p className="catalog-empty">
          填写供应商 API Key 后自动读取；也可以在下方手动添加模型。
        </p>
      ) : issue ? (
        <p className="catalog-error" role="alert">
          {issue}。可重试刷新，或在下方手动添加。
        </p>
      ) : loading && !directory ? (
        <p className="catalog-empty" role="status">
          正在向 {provider.name} 请求模型列表…
        </p>
      ) : null}
      {!!directory?.models.length && (
        <>
          <div className="catalog-toolbar">
            <label className="search">
              <Search size={15} />
              <input
                aria-label="搜索供应商可用模型"
                placeholder="按名称或模型 ID 搜索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="catalog-filter">
              <input
                type="checkbox"
                checked={onlyNew}
                onChange={(e) => setOnlyNew(e.target.checked)}
              />
              仅看未添加
            </label>
            <span className="catalog-caption">{models.length} 个结果</span>
          </div>
          <div
            className="discovered-models"
            tabIndex={0}
            aria-label="供应商模型列表"
          >
            {models.map((m) => (
              <div className="discovered-model" key={m.model}>
                <div>
                  <strong>{m.displayName}</strong>
                  <small>{m.model}</small>
                  <p>
                    上下文{" "}
                    {m.declared.contextWindow?.toLocaleString() || "未知"} ·
                    工具 {declaration(m.declared.tools)} · 视觉{" "}
                    {declaration(m.declared.vision)}
                  </p>
                </div>
                <button
                  className="button"
                  disabled={!!busy || loading || configured.has(m.model)}
                  onClick={() =>
                    act("add-discovered", () =>
                      api.call("model-add-discovered", provider.id, m.model),
                    )
                  }
                >
                  {configured.has(m.model) ? (
                    <Check size={14} />
                  ) : (
                    <Plus size={14} />
                  )}
                  {configured.has(m.model) ? "已添加" : "加入配置"}
                </button>
              </div>
            ))}
            {!models.length && (
              <p className="catalog-empty">没有符合筛选的模型。</p>
            )}
          </div>
        </>
      )}
      {available &&
        directory &&
        !issue &&
        !loading &&
        !directory.models.length && (
          <p className="catalog-empty">
            供应商返回了空列表，可刷新重试或手动添加模型。
          </p>
        )}
      {directory?.truncated && (
        <p className="hint">供应商返回分页或过长列表，当前只展示已读取部分。</p>
      )}
      <p className="catalog-footnote">
        仅查询模型目录，不发送推理请求；能力以供应商声明为准。
        {directory?.time && !issue && (
          <> · {new Date(directory.time).toLocaleTimeString()} 更新</>
        )}
      </p>
    </section>
  );
}
