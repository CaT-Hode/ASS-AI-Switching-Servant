// ZCode's Coding Plan/MCP APIs are separate from Start Plan billing. All remote
// operations here are GETs; missing native API keys are never created or saved.
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const list = (v) => Array.isArray(v) ? v.slice(0, 100) : [];
const string = (v, max = 512) => typeof v === "string" && v.trim() && v.length <= max && !/[\x00-\x1f\x7f]/.test(v) ? v.trim() : null;
const secret = (v) => string(v, 65536);
const numeric = (v) => (typeof v === "number" || typeof v === "string" && v.trim()) && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
function context(value) {
  if (!object(value) || !["personal", "team"].includes(value.kind)) return null;
  const result = { kind: value.kind };
  if (value.kind === "team") for (const key of ["productId", "organizationId", "projectId"]) {
    const v = string(value[key]); if (!v) return null; result[key] = v;
  }
  if (secret(value.apiKey)) result.apiKey = value.apiKey.trim();
  return result;
}
function capture(family, identity, settings, readKey) {
  if (!["zai", "bigmodel"].includes(family) || !string(identity)) return [];
  const selection = settings?.providerFamilyConnectionSelections?.[family], result = [];
  const personalId = `account:${family}-individual-coding-plan`;
  const read = (key) => { try { return secret(readKey(key)); } catch { return null; } };
  const personalKey = read(`account-provider:coding-plan:${personalId}:account:${encodeURIComponent(identity)}:api-key`);
  if (personalKey || selection?.kind === "individual-coding-plan") result.push({ kind: "personal", ...(personalKey ? { apiKey: personalKey } : {}) });
  if (selection?.kind === "team-coding-plan") {
    const selected = context({ kind: "team", productId: selection.productId,
      organizationId: selection.organizationId, projectId: selection.projectId });
    if (selected) {
      const scope = ["team", `account:${family}-team-coding-plan`, selected.productId, selected.organizationId, selected.projectId]
        .map(encodeURIComponent).join(":");
      const key = read(`account-provider:${scope}:account:${encodeURIComponent(identity)}:api-key`);
      result.push({ ...selected, ...(key ? { apiKey: key } : {}) });
    }
  }
  return result;
}
function official(env, family) {
  const expected = family === "zai" ? { ZAI_BUSINESS_BASE_URL: "https://api.z.ai", ZAI_OAUTH_ORIGIN: "https://chat.z.ai" }
    : { BIGMODEL_API_BASE_URL: "https://bigmodel.cn" };
  return Object.entries(expected).every(([key, origin]) => {
    if (!env[key]?.trim()) return true;
    try { const u = new URL(env[key]); return u.origin === origin && !u.username && !u.password &&
      !u.search && !u.hash && !u.pathname.replace(/\/+$/, ""); } catch { return false; }
  });
}
function data(payload) {
  if (!object(payload) || payload.success === false ||
      (payload.code != null && ![0, 200, "0", "200"].includes(payload.code)) || payload.data == null)
    throw Error("Coding Plan 接口未返回有效资料");
  return payload.data;
}
function entitlement(payload, c) {
  const d = data(payload);
  if (c.kind === "team") {
    if (!object(d) || typeof d.hasSubscription !== "boolean") throw Error("Team 套餐格式无效");
    if (!d.hasSubscription) return { active: false, status: "未开通" };
    if (d.status === "EXPIRED") return { active: false, status: "已到期" };
    if (d.status === "EFFECTIVE" && d.memberGrantStatus === "UNASSIGNED") return { active: false, status: "未分配成员额度" };
    if (d.status !== "EFFECTIVE" || d.memberGrantStatus !== "VALID" || d.productId !== c.productId)
      throw Error("Team 套餐身份或状态尚未确认");
    return { active: true, plan: d };
  }
  if (!Array.isArray(d)) throw Error("个人套餐格式无效");
  const plans = list(d).filter((p) => [p?.productId, p?.productName].some((s) => typeof s === "string" && s.toLowerCase().includes("coding")));
  const active = plans.find((p) => string(p.productId) && p.status === "VALID" && p.inCurrentPeriod === true);
  if (active) return { active: true, plan: active };
  if (plans.some((p) => typeof p.status !== "string" || typeof p.inCurrentPeriod !== "boolean")) throw Error("个人套餐状态尚未确认");
  return { active: false, status: "无有效套餐" };
}
function requests(p) {
  if (!["zai", "bigmodel"].includes(p.family) || !secret(p.oauthAccess)) return [];
  // Older BigModel clients accidentally cached the ZCode JWT as a business
  // token; it must not be sent to the BigModel business host.
  if (p.family === "bigmodel" && p.oauthAccess === p.apiKey) return [];
  const host = p.family === "zai" ? "https://api.z.ai" : "https://bigmodel.cn";
  const business = { authorization: p.family === "zai" ? "Bearer " + p.oauthAccess : p.oauthAccess };
  const rows = [], seen = new Set();
  for (const raw of list(p.coding)) {
    const c = context(raw); if (!c) continue;
    const section = "coding-" + c.kind;
    if (seen.has(section)) continue; seen.add(section);
    const label = c.kind === "team" ? "Team" : "Coding Plan";
    const scope = c.kind === "team" ? { "bigmodel-organization": c.organizationId, "bigmodel-project": c.projectId } : {};
    const headers = { ...business, ...scope };
    let keyJob, planJob;
    const key = (get, protect) => keyJob ||= (async () => {
      if (c.apiKey) { protect(c.apiKey); return c.apiKey; }
      const customer = data((await get(host + "/api/biz/customer/getCustomerInfo", business)).data);
      const organizations = list(customer?.organizations);
      let organization, project;
      if (c.kind === "team") {
        organization = organizations.find((o) => o?.organizationId === c.organizationId);
        project = list(organization?.projects).find((r) => r?.projectId === c.projectId && String(r.projectType) === "2");
      } else {
        const choices = organizations.filter((o) => string(o?.organizationId) && list(o.projects).some((r) => string(r?.projectId) && String(r.projectType) !== "2"));
        organization = choices.find((o) => String(o.organizationName || "").includes("默认机构")) || choices[0];
        const choicesP = list(organization?.projects).filter((r) => string(r?.projectId) && String(r.projectType) !== "2");
        project = choicesP.find((r) => String(r.projectName || "").includes("默认项目")) || choicesP[0];
      }
      if (!string(organization?.organizationId) || !string(project?.projectId)) throw Error("未找到当前账户的项目");
      const url = host + "/api/biz/v1/organization/" + encodeURIComponent(organization.organizationId) +
        "/projects/" + encodeURIComponent(project.projectId) + "/api_keys";
      const keys = data((await get(url, headers)).data);
      if (!Array.isArray(keys)) throw Error("API Key 列表格式无效");
      const entry = list(keys).find((k) => k?.name === (c.kind === "team" ? "zcode-team-api-key" : "zcode-api-key") &&
        (c.kind !== "team" || k.keyType === 2) && secret(k.apiKey));
      if (!entry) throw Error("请先在 ZCode 配置此套餐的 API Key");
      protect(entry.apiKey);
      const copied = data((await get(url + "/copy/" + encodeURIComponent(entry.apiKey), headers)).data);
      const suffix = secret(copied?.secretKey);
      if (!suffix && p.family === "zai") throw Error("未能读取此套餐的 API Key");
      if (suffix) protect(suffix);
      const value = suffix ? entry.apiKey + "." + suffix : entry.apiKey;
      protect(value); return value;
    })();
    const plan = (get, protect) => planJob ||= (async () => {
      const response = c.kind === "team"
        ? await get(host + "/api/biz/team/subscribe/product/querySubscribeDetail", headers)
        : await get(host + "/api/biz/subscription/list", { authorization: await key(get, protect) });
      return { ...response, entitlement: entitlement(response.data, c) };
    })();
    rows.push({ section: section + "-plan", label: label + " 套餐", context: c, part: "plan",
      run: (get, protect) => plan(get, protect) });
    rows.push({ section: section + "-usage", label: label + " 额度", context: c, part: "usage", run: async (get, protect) => {
      if (!(await plan(get, protect)).entitlement.active) return { empty: true };
      return get(host + "/api/monitor/usage/quota/limit" + (c.kind === "team" ? "?type=2" : ""),
        { authorization: await key(get, protect), ...scope });
    } });
    rows.push({ section: section + "-mcp", label: label + " MCP", context: c, part: "mcp", run: async (get, protect) => {
      if (!(await plan(get, protect)).entitlement.active) return { empty: true };
      const mcpHeaders = { authorization: "Bearer " + p.apiKey, "x-bigmodel-authorization": "Bearer " + p.oauthAccess };
      if (c.kind === "personal") mcpHeaders["bigmodel-target-type"] = "PERSONAL";
      else if (p.family === "bigmodel") Object.assign(mcpHeaders, { "bigmodel-target-type": "TEAM", ...scope });
      // Z.ai Team does not carry target/organization/project headers on MCP.
      return get("https://zcode.z.ai/api/v1/mcp/usage", mcpHeaders);
    } });
  }
  return rows;
}
function parse(request, response, { safeText }) {
  if (response.empty) return [];
  const c = request.context, prefix = "coding-" + c.kind, label = c.kind === "team" ? "Team" : "Coding Plan", fields = [];
  const add = (id, title, value, extra = {}) => { const clean = safeText(value);
    if (clean !== undefined && clean !== null && clean !== "") fields.push({ id: prefix + "-" + id, label: title, value: clean, ...extra }); };
  const date = (id, title, value) => { if (!string(value)) return;
    // Business datetimes may omit a time zone. Preserve the documented value,
    // instead of silently interpreting it in the ASS machine's local zone.
    if (!/[zZ]$|[+-]\d\d:\d\d$/.test(value)) { add(id, title, value); return; }
    const ms = Date.parse(value); if (Number.isFinite(ms)) add(id, title, new Date(ms).toISOString(), { kind: "date" }); };
  const amount = (id, title, value, unit) => { const n = numeric(value); if (n !== null) add(id, title, String(n), { kind: "amount", unit }); };
  const quota = (id, title, value, resetMs) => {
    const n = numeric(value); if (n === null) return;
    const resetsAt = typeof resetMs === "number" && Number.isFinite(resetMs) && resetMs > 0 && resetMs < 8.64e15 ? new Date(resetMs).toISOString() : undefined;
    add("quota-" + id, title, String(n), { kind: "quota", usedPercent: n, remainingPercent: Math.max(0, Math.min(100, 100 - n)), resetsAt });
  };
  if (request.part === "plan") {
    const e = response.entitlement || entitlement(response.data, c), p = e.plan;
    add("status", label, e.active ? "有效" : e.status);
    if (c.kind === "team") { add("organization", "组织 ID", c.organizationId); add("project", "项目 ID", c.projectId); }
    if (p) {
      add("plan", label + " 套餐", p.productName || p.productId); add("product", "套餐 ID", p.productId);
      add("cycle", "计费周期", c.kind === "team" ? p.subscribePeriod : p.billingCycle);
      if (c.kind === "team") date("expiry", "Team 到期", p.subscribeEndTime);
      else {
        const renewal = p.autoRenew === true || p.autoRenew === 1;
        if (p.autoRenew !== undefined) add("renewal", "自动续费", renewal ? "开启" : "关闭");
        date(renewal ? "renew-at" : "expiry", renewal ? "下次续费" : "到期时间", p.nextRenewTime);
      }
    }
  } else if (request.part === "mcp") {
    if (response.data?.code !== 0) throw Error("MCP 额度接口失败");
    const d = data(response.data), total = d.total_usage;
    if (!object(total) || [total.used, total.limit, total.remaining].some((n) => typeof n !== "number" || !Number.isFinite(n)))
      throw Error("MCP 额度格式无效");
    amount("mcp-remaining", label + " MCP 剩余", total.remaining, "次");
    amount("mcp-total", label + " MCP 总额", total.limit, "次");
    amount("mcp-used", label + " MCP 已用", total.used, "次");
    if (total.limit > 0) quota("mcp", label + " MCP", Math.max(0, 100 - Math.min(total.remaining, total.limit) / total.limit * 100),
      typeof d.next_refresh_at === "number" ? d.next_refresh_at * 1000 : undefined);
  } else {
    const d = data(response.data);
    if (!Array.isArray(d.limits)) throw Error("Coding Plan 额度格式无效");
    add("level", label + " 等级", d.level);
    for (const [i, limit] of list(d.limits).entries()) {
      if (!object(limit) || !string(limit.type)) continue;
      const token = ["TOKENS_LIMIT", "CREDIT_LIMIT"].includes(limit.type);
      const window = limit.unit === 3 && limit.number === 5 ? "5h" : limit.unit === 6 ? "周" :
        limit.unit === 5 && limit.number === 1 ? "月" : [limit.type, limit.unit, limit.number].filter((v) => v !== undefined).join(" / ");
      const title = label + " " + (token ? window : limit.type === "TIME_LIMIT" ? "工具 · " + window : window);
      quota(String(i), title, limit.percentage, limit.nextResetTime);
      // Never infer token counts or totals from percentage; wire counts may be
      // credits or calls. Unknown count units remain the raw type identifier.
      const unit = limit.type === "TIME_LIMIT" ? "次" : limit.type === "CREDIT_LIMIT" ? "credits" : limit.type;
      amount("remaining-" + i, title + "剩余", limit.remaining, unit);
    }
    if (!fields.length && d.limits.length) throw Error("未返回可识别的 Coding Plan 额度");
  }
  return fields;
}
module.exports = { context, capture, official, requests, parse };
