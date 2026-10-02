function assertTaskOutcome(value) {
  const response = value?.response || value;
  if (value?.error || response?.error || ['failed', 'cancelled', 'canceled'].includes(response?.status) || ['error', 'response.failed'].includes(value?.type))
    throw Object.assign(Error('上游模型任务失败，请检查供应商状态或模型参数'), { code: 'model_task_failed' });
}
async function readTaskJSON(response) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 128 * 1024 * 1024) throw Error('上游响应超过大小限制');
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8'), value = JSON.parse(text);
  assertTaskOutcome(value); return { text, value };
}
module.exports = { assertTaskOutcome, readTaskJSON };
