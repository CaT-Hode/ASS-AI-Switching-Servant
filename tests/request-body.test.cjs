const { test } = require("node:test"), assert = require("node:assert/strict");
const { Readable } = require("node:stream"), zlib = require("node:zlib");
const { readJSON } = require("../core/request-body.cjs");
const request = (buffer, encoding) => Object.assign(Readable.from([buffer]), { headers: { "content-encoding": encoding } });
test("Codex compressed JSON bodies decode without blocking and enforce both input/output limits", async () => {
  const data = { model: "ASS_fixture::gpt-6-astra", input: "测试".repeat(1000) }, bytes = Buffer.from(JSON.stringify(data));
  for (const [encoding, compress] of Object.entries({ identity: b => b, zstd: zlib.zstdCompressSync,
    gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync })) {
    assert.deepEqual(await readJSON(request(compress(bytes), encoding)), data);
    await assert.rejects(readJSON(request(compress(bytes), encoding), 128), { status: 413 });
  }
  await assert.rejects(readJSON(request(Buffer.from("broken"), "zstd")), { status: 400 });
  await assert.rejects(readJSON(request(Buffer.from("{}"), "unknown")), { status: 415 });
  await assert.rejects(readJSON(request(Buffer.from("broken"), "identity")), { status: 400 });
});
