import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ElapsedTime } from "./diagnostic-time.jsx";
import { exactTime } from "./relative-time.mjs";
const api = window.ass;
export function SupplierQuota({ p, state }) {
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const clientId =
    p.id === "official"
      ? "codex"
      : p.id.startsWith("native-")
        ? p.id.slice(7)
        : null;
  const client = state.harnesses.clients.find((c) => c.id === clientId);
  const accounts =
    client?.accounts.filter(
      (a) => a.kind !== "api" && (a.quota?.canRefresh || a.profile?.canRefresh),
    ) || [];
  const selected = state.preferences.quotaAccounts?.[p.id];
  const account =
    accounts.find((a) => a.id === selected) ||
    accounts.find((a) => a.id === client?.selected) ||
    accounts[0];
  const profile = clientId
    ? account?.quota || account?.profile
    : state.providerInfo?.[p.id];
  const balance =
    !clientId && !profile?.canRefresh ? state.balances[p.id] : null;
  const queryable = clientId ? !!account : p.hasKey && p.enabled !== false;
  const fields = profile?.fields || [];
  const quotas = fields.filter((f) => f.kind === "quota");
  const amounts = fields.filter(
    (f) => f.id.startsWith("balance-") || f.id === "remaining",
  );
  const rows = amounts.length
    ? amounts.map((f) => ({ label: f.label, value: f.value, unit: f.unit }))
    : balance?.ok
      ? balance.rows || [balance]
      : [];
  const time = profile?.updatedAt || balance?.time;
  const warning = error || profile?.error || balance?.error;
  const caption = (a) =>
    a.profile?.fields?.find((f) => f.id === "email")?.value || a.label;
  useEffect(() => {
    setError("");
    if (!queryable) return;
    let mounted = true;
    const refresh = async () => {
      if (document.hidden) return;
      setLoading(true);
      try {
        await api.call("supplier-refresh", p.id, account?.id, true);
      } catch {
        if (mounted) setError("额度暂不可用");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    refresh();
    const timer = setInterval(refresh, 5 * 60000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [
    p.id,
    queryable,
    account?.id,
    profile?.updatedAt,
    state.modelDirectoryRevisions?.[p.id],
  ]);
  if (!queryable && !time) return null;
  return (
    <div className="supplier-quota" aria-label={p.name + " 额度"}>
      <div className="supplier-quota-heading">
        {accounts.length > 1 ? (
          <select
            aria-label={p.name + " 额度账户"}
            value={account.id}
            title="仅选择展示额度的账户，不切换客户端登录"
            onChange={async (e) => {
              try {
                await api.call("ui-preferences", {
                  quotaAccounts: { [p.id]: e.target.value },
                });
              } catch {
                setError("账户展示选择保存失败");
              }
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {caption(a)}
              </option>
            ))}
          </select>
        ) : (
          <span
            className="quota-account"
            title={account ? caption(account) : "当前接口返回的额度"}
          >
            {account
              ? caption(account)
              : quotas.length || rows.some((r) => r.unit === "%")
                ? "剩余额度"
                : "可用余额"}
          </span>
        )}
        <button
          className="model-icon"
          aria-label={p.name + " 刷新额度"}
          title="刷新额度"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            setError("");
            try {
              await api.call("supplier-refresh", p.id, account?.id);
            } catch {
              setError("额度查询失败");
            } finally {
              setLoading(false);
            }
          }}
        >
          <RefreshCw size={14} className={loading ? "spin" : undefined} />
        </button>
      </div>
      {!!quotas.length && (
        <div className="supplier-quota-windows">
          {quotas.map((q) => (
            <div
              key={q.id}
              title={
                q.resetsAt ? "重置：" + exactTime(q.resetsAt) : "未返回重置时间"
              }
            >
              <div>
                <span>{q.label}</span>
                <strong>
                  {q.remainingPercent.toLocaleString("zh-CN", {
                    maximumFractionDigits: 1,
                  })}
                  % 剩余
                </strong>
              </div>
              <progress
                aria-label={p.name + " " + q.label + " 剩余额度"}
                value={q.remainingPercent}
                max={100}
              />
            </div>
          ))}
        </div>
      )}
      {!!rows.length && (
        <div className="supplier-amount">
          {rows.map((r, i) => (
            <span key={i} title={r.label}>
              {r.value} <small>{r.unit}</small>
            </span>
          ))}
        </div>
      )}
      {!quotas.length && !rows.length && (
        <span className="muted tiny">
          {loading
            ? "查询中…"
            : warning
              ? "额度暂不可用"
              : time
                ? "未返回额度"
                : "尚未查询"}
        </span>
      )}
      <div className="supplier-quota-time">
        {time && <ElapsedTime value={time} />}
        {warning && (
          <span className="danger" title={warning}>
            {time ? "刷新失败 · 保留上次" : "查询失败"}
          </span>
        )}
      </div>
    </div>
  );
}
