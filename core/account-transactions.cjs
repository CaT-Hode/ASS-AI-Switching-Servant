// ASS-owned settings only. Native credentials and running client configs are never rewritten.
function transaction(store, harnesses, change) {
  const beforeStore = structuredClone(store.state),
    beforeClients = structuredClone(harnesses.state);
  try {
    return change();
  } catch (error) {
    store.state = beforeStore;
    harnesses.state = beforeClients;
    const failures = [];
    try {
      store.save();
    } catch (e) {
      failures.push(e);
    }
    try {
      harnesses.save();
    } catch (e) {
      failures.push(e);
    }
    if (failures.length)
      throw new Error(
        error.message + "；恢复配置失败，请检查数据目录写入权限后重试",
      );
    throw error;
  }
}
function saveBoundApi(store, harnesses, client, input) {
  harnesses.spec(client);
  return transaction(store, harnesses, () => {
    const id = store.updateProvider(input);
    harnesses.bindApi(client, id);
    return id;
  });
}
function saveModel(store, harnesses, provider, model, originalName, expected) {
  return transaction(store, harnesses, () => {
    store.model(provider, model, originalName, expected);
    if (originalName && originalName !== model.model.trim())
      harnesses.reconcileModel(provider, originalName, model.model.trim());
  });
}
function deleteModel(store, harnesses, provider, name, expected) {
  return transaction(store, harnesses, () => {
    store.removeModel(provider, name, expected);
    harnesses.reconcileModel(provider, name, null);
  });
}
module.exports = { saveBoundApi, saveModel, deleteModel };
