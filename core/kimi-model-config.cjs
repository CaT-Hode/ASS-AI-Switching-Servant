// Official Kimi Code 2.x uses provider_id/name, with legacy provider/model
// aliases and an optional top-level default_provider. Routing is kept separate
// from display/capability overrides; contradictory aliases are not guessed.
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const has = v => typeof v === 'string' && !!v.trim();
function normalize(config = {}) {
  const providers = { ...(object(config.providers) ? config.providers : {}) }, models = [], issues = [];
  for (const [alias, raw] of Object.entries(object(config.models) ? config.models : {})) {
    if (!object(raw)) continue;
    if (has(raw.provider_id) && has(raw.provider) && raw.provider_id !== raw.provider ||
        has(raw.name) && has(raw.model) && raw.name !== raw.model) {
      issues.push('Kimi 模型的路由别名相互冲突，未推断目标'); continue;
    }
    let provider = raw.provider_id ?? raw.provider ?? config.default_provider;
    const name = raw.name ?? raw.model;
    if (!has(name)) continue;
    if (!has(provider) && has(raw.base_url)) {
      // Native derives the inline provider identity from the endpoint host.
      try { provider = new URL(raw.base_url).host; } catch { issues.push('Kimi 内联模型地址无效'); continue; }
      const inline = { type: raw.protocol, base_url: raw.base_url,
        ...(has(raw.api_key) ? { api_key: raw.api_key } : {}),
        ...(has(raw.api_key_env) ? { api_key_env: raw.api_key_env } : {}), ...(raw.oauth ? { oauth: raw.oauth } : {}) };
      if (providers[provider] && JSON.stringify(providers[provider]) !== JSON.stringify(inline)) {
        issues.push('Kimi 内联供应商与现有路由冲突，未推断目标'); continue;
      }
      providers[provider] = inline;
    }
    if (!has(provider) || !object(providers[provider])) { issues.push('Kimi 模型引用了不存在的供应商'); continue; }
    models.push({ ...raw, provider, model: name, alias });
  }
  return { providers, models, issues };
}
function environmentIssue(env = {}) {
  const nonempty = k => has(env[k]);
  if (nonempty('KIMI_MODEL_NAME')) {
    const names = ['KIMI_MODEL_NAME', 'KIMI_MODEL_PROVIDER_TYPE', 'KIMI_MODEL_BASE_URL', 'KIMI_MODEL_API_KEY'].filter(nonempty);
    return nonempty('KIMI_MODEL_API_KEY')
      ? `环境变量 ${names.join('、')} 覆盖 Kimi 模型与授权，切换 OAuth 不会成为有效账户`
      : '环境变量 KIMI_MODEL_NAME 已设置但缺少 KIMI_MODEL_API_KEY，Kimi 原生配置无效';
  }
  return ['KIMI_API_KEY', 'KIMI_BASE_URL', 'KIMI_CODE_BASE_URL', 'KIMI_CODE_OAUTH_HOST', 'KIMI_OAUTH_HOST'].some(nonempty)
    ? '当前环境变量覆盖 Kimi 授权或环境地址，请先清除覆盖后再切换' : '';
}
module.exports = { normalize, environmentIssue };
