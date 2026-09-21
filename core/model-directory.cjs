const { discoverModels } = require("./model-inspection.cjs");

class ModelDirectory {
  constructor({
    getProvider,
    readOfficial,
    fetchUpstream,
    onChange = () => {},
    now = Date.now,
  }) {
    Object.assign(this, {
      getProvider,
      readOfficial,
      fetchUpstream,
      onChange,
      now,
    });
    this.results = Object.create(null);
    this.revisions = Object.create(null);
    this.requests = new Map();
    this.completed = new Map();
  }
  jobs() {
    return Object.fromEntries(
      [...this.requests.keys()].map((id) => [id, true]),
    );
  }
  invalidate(id) {
    const ids = id
      ? [id]
      : new Set([
          ...Object.keys(this.results),
          ...this.requests.keys(),
          ...Object.keys(this.revisions),
        ]);
    for (const key of ids) {
      this.requests.get(key)?.controller.abort();
      this.requests.delete(key);
      this.completed.delete(key);
      delete this.results[key];
      this.revisions[key] = (this.revisions[key] || 0) + 1;
    }
  }
  read(id, { refresh = false } = {}) {
    if (this.requests.has(id)) return this.requests.get(id).promise;
    const cached = this.results[id];
    const ttl = cached?.error ? 30000 : 5 * 60 * 1000;
    if (!refresh && cached && this.now() - this.completed.get(id) < ttl)
      return Promise.resolve(cached);
    const provider = id === "official" ? null : this.getProvider(id);
    if (id !== "official" && !provider)
      return Promise.reject(Error("供应商不存在"));
    const request = { controller: new AbortController(), promise: null };
    this.requests.set(id, request);
    request.promise = Promise.resolve()
      .then(async () => {
        let report;
        try {
          report =
            id === "official"
              ? await this.readOfficial()
              : await discoverModels(
                  provider,
                  this.fetchUpstream,
                  request.controller.signal,
                );
        } catch (error) {
          report = {
            time: new Date(this.now()).toISOString(),
            error: error.message,
            models: [],
            source: "供应商目录",
          };
        }
        // Saving/removing a provider cancels the old request. Never publish old-key results.
        if (
          this.requests.get(id) !== request ||
          request.controller.signal.aborted
        )
          return null;
        this.results[id] = report;
        this.completed.set(id, this.now());
        return report;
      })
      .finally(() => {
        if (this.requests.get(id) === request) {
          this.requests.delete(id);
          this.onChange();
        }
      });
    this.onChange();
    return request.promise;
  }
}
module.exports = { ModelDirectory };
