"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const { install } = require("./wasm-loader.js");

// A real module exporting answer() = 42, split across section boundaries.
const wasmBytes = Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0,
    7, 10, 1, 6, 97, 110, 115, 119, 101, 114, 0, 0,
    10, 6, 1, 4, 0, 65, 42, 11
]);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function fixture(overrides = {}) {
    const bodies = new Map();
    const manifest = { version: 1, bytes: wasmBytes.length, sha256: sha256(wasmBytes), raw: [] };
    for (let start = 0; start < wasmBytes.length; start += 13) {
        const bytes = wasmBytes.slice(start, start + 13);
        const part = { url: `wasm/part-${manifest.raw.length}.bin`, bytes: bytes.length, sha256: sha256(bytes) };
        manifest.raw.push(part);
        bodies.set(part.url, bytes);
    }
    const gzip = gzipSync(wasmBytes);
    manifest.gzip = { url: "wasm/module.wasm.gz.bin", bytes: gzip.length, sha256: sha256(gzip) };
    bodies.set(manifest.gzip.url, gzip);
    const requests = [], statuses = [], errors = [], successes = [], methods = [];
    const module = { setStatus: text => statuses.push(text) };
    const options = {
        crypto: webcrypto,
        DecompressionStream: globalThis.DecompressionStream,
        console: { error: (...args) => errors.push(args) },
        document: undefined,
        WebAssembly: {
            instantiateStreaming: async (...args) => { methods.push("stream"); return WebAssembly.instantiateStreaming(...args); },
            instantiate: async (...args) => { methods.push("buffer"); return WebAssembly.instantiate(...args); }
        },
        fetch: async url => {
            const key = new URL(url).pathname.slice("/game/".length);
            requests.push(key);
            const bytes = bodies.get(key);
            return bytes ? new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })
                : new Response("missing", { status: 404 });
        },
        ...overrides
    };
    const state = install(module, manifest, "https://example.test/game/", options);
    const start = () => {
        assert.deepEqual(module.instantiateWasm({}, (instance, compiled) => successes.push({ instance, compiled })), {});
        return state.ready;
    };
    return { manifest, bodies, requests, statuses, errors, successes, methods, module, options, state, start };
}

function assertSuccess(ctx) {
    assert.equal(ctx.successes.length, 1);
    assert.ok(ctx.successes[0].instance instanceof WebAssembly.Instance);
    assert.ok(ctx.successes[0].compiled instanceof WebAssembly.Module);
    assert.equal(ctx.successes[0].instance.exports.answer(), 42);
    assert.equal(ctx.errors.length, 0);
    assert.equal(ctx.statuses.at(-1), "Preparing...");
    assert.ok(ctx.statuses.some(text => /^Downloading\.\.\. \(\d+\/\d+\)$/.test(text)));
    assert.ok(!ctx.statuses.includes(""), "Downloading must not reveal the canvas early");
}

test("gzip verifies the compressed payload and instantiates the real module by streaming", async () => {
    const ctx = fixture();
    await ctx.start();
    assertSuccess(ctx);
    assert.deepEqual(ctx.requests, [ctx.manifest.gzip.url]);
    assert.deepEqual(ctx.methods, ["stream"]);
});

test("missing DecompressionStream uses verified raw parts in order", async () => {
    const ctx = fixture({ DecompressionStream: undefined });
    await ctx.start();
    assertSuccess(ctx);
    assert.deepEqual(ctx.requests, ctx.manifest.raw.map(part => part.url));
    assert.deepEqual(ctx.methods, ["stream"]);
});

test("gzip works without instantiateStreaming", async () => {
    const ctx = fixture({ WebAssembly: { instantiate: WebAssembly.instantiate } });
    await ctx.start();
    assertSuccess(ctx);
    assert.deepEqual(ctx.requests, [ctx.manifest.gzip.url]);
});

test("raw parts work without instantiateStreaming", async () => {
    const ctx = fixture({ DecompressionStream: undefined, WebAssembly: { instantiate: WebAssembly.instantiate } });
    await ctx.start();
    assertSuccess(ctx);
    assert.deepEqual(ctx.requests, ctx.manifest.raw.map(part => part.url));
});

test("a corrupt gzip checksum falls back to raw without reporting a final error", async () => {
    const ctx = fixture();
    const corrupted = Uint8Array.from(ctx.bodies.get(ctx.manifest.gzip.url));
    corrupted[corrupted.length - 1] ^= 1;
    ctx.bodies.set(ctx.manifest.gzip.url, corrupted);
    await ctx.start();
    assertSuccess(ctx);
    assert.deepEqual(ctx.requests, [ctx.manifest.gzip.url, ...ctx.manifest.raw.map(part => part.url)]);
});

test("a verified but invalid gzip stream falls back to raw", async () => {
    const ctx = fixture();
    const bad = Uint8Array.from(ctx.bodies.get(ctx.manifest.gzip.url));
    bad[0] = 0;
    ctx.bodies.set(ctx.manifest.gzip.url, bad);
    ctx.manifest.gzip.sha256 = sha256(bad);
    await ctx.start();
    assertSuccess(ctx);
    assert.deepEqual(ctx.requests, [ctx.manifest.gzip.url, ...ctx.manifest.raw.map(part => part.url)]);
});

test("gzip decompressed length is bounded before instantiation succeeds", async () => {
    const ctx = fixture();
    const bad = gzipSync(new Uint8Array(wasmBytes.length + 1));
    ctx.bodies.set(ctx.manifest.gzip.url, bad);
    ctx.manifest.gzip.bytes = bad.length;
    ctx.manifest.gzip.sha256 = sha256(bad);
    await ctx.start();
    assertSuccess(ctx);
    assert.ok(ctx.requests.includes(ctx.manifest.raw[0].url));
});

test("a raw checksum error prevents the native success callback", async () => {
    const ctx = fixture({ DecompressionStream: undefined });
    const part = ctx.manifest.raw[1];
    const bad = ctx.bodies.get(part.url).slice();
    bad[0] ^= 1;
    ctx.bodies.set(part.url, bad);
    await assert.rejects(ctx.start(), /checksum mismatch/);
    assert.equal(ctx.successes.length, 0);
    assert.equal(ctx.errors.length, 1);
    assert.equal(ctx.statuses.at(-1), "加载失败，请刷新重试。");
    assert.ok(!ctx.requests.some(url => url.endsWith(".wasm")));
});

test("a missing raw part fails without requesting the absent original WASM", async () => {
    const ctx = fixture({ DecompressionStream: undefined });
    ctx.bodies.delete(ctx.manifest.raw[0].url);
    await assert.rejects(ctx.start(), /HTTP 404/);
    assert.equal(ctx.successes.length, 0);
    assert.equal(ctx.errors.length, 1);
    assert.equal(ctx.requests.length, 1);
});

test("an HTML fallback response is rejected", async () => {
    const ctx = fixture({ DecompressionStream: undefined, fetch: async () => new Response("<html>fallback</html>", { headers: { "Content-Type": "text/html" } }) });
    await assert.rejects(ctx.start(), /returned HTML/);
    assert.equal(ctx.successes.length, 0);
    assert.equal(ctx.errors.length, 1);
});

test("a truncated raw response is rejected before compilation", async () => {
    const ctx = fixture({ DecompressionStream: undefined });
    const part = ctx.manifest.raw[0];
    ctx.bodies.set(part.url, ctx.bodies.get(part.url).slice(1));
    await assert.rejects(ctx.start(), /length mismatch/);
    assert.equal(ctx.successes.length, 0);
});

test("a stalled request times out and gives a visible retry state", async () => {
    const nodes = { spinner: { style: {} }, progress: { hidden: false } };
    const container = { appendChild: node => { nodes[node.id] = node; } };
    const document = {
        getElementById: id => nodes[id],
        querySelector: () => container,
        createElement: () => ({ style: {}, addEventListener() {} })
    };
    let aborted = false;
    const ctx = fixture({
        DecompressionStream: undefined, timeoutMs: 20, document,
        fetch: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }))
    });
    await assert.rejects(ctx.start(), /下载超时/);
    assert.equal(aborted, true);
    assert.equal(ctx.errors.length, 1);
    assert.equal(ctx.statuses.at(-1), "加载失败，请刷新重试。");
    assert.equal(nodes.spinner.style.display, "none");
    assert.equal(nodes.progress.hidden, true);
    assert.equal(nodes["phi-cf-wasm-retry"].textContent, "刷新重试");
});

test("repeat hook calls cannot instantiate or invoke success twice", async () => {
    const ctx = fixture();
    const first = ctx.start();
    let repeats = 0;
    assert.deepEqual(ctx.module.instantiateWasm({}, () => repeats++), {});
    await first;
    assertSuccess(ctx);
    assert.equal(repeats, 0);
    assert.equal(ctx.requests.length, 1);
});

test("a missing gzip payload falls back to raw", async () => {
    const ctx = fixture();
    ctx.bodies.delete(ctx.manifest.gzip.url);
    await ctx.start();
    assertSuccess(ctx);
    assert.deepEqual(ctx.requests, [ctx.manifest.gzip.url, ...ctx.manifest.raw.map(part => part.url)]);
});
