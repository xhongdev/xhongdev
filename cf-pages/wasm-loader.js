(function (root, factory) {
    "use strict";
    var api = factory(root);
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.PhiCFWasm = api;
        api.install(root.Module, root.__PhiCFWasmManifest,
            new URL("./", root.document.currentScript.src));
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
    "use strict";

    function install(module, manifest, baseURL, options) {
        options = options || {};
        function option(name) {
            return Object.prototype.hasOwnProperty.call(options, name) ? options[name] : root[name];
        }
        var fetchFile = option("fetch");
        var wasm = option("WebAssembly");
        var Decompress = option("DecompressionStream");
        var crypto = option("crypto");
        var document = option("document");
        var log = option("console");
        var timeoutMs = options.timeoutMs === undefined ? 30000 : options.timeoutMs;
        var state = { ready: null };
        var requests = new Set();
        var failed = false;

        function checkFile(file) {
            if (!file || typeof file.url !== "string" || !file.url ||
                !Number.isSafeInteger(file.bytes) || file.bytes <= 0 ||
                typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(file.sha256)) {
                throw new Error("Invalid WASM payload manifest");
            }
        }
        if (!module || !manifest || manifest.version !== 1 ||
            !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 ||
            typeof manifest.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(manifest.sha256) ||
            !Array.isArray(manifest.raw) || !manifest.raw.length) {
            throw new Error("Invalid WASM manifest");
        }
        manifest.raw.forEach(checkFile);
        if (manifest.raw.reduce(function (sum, file) { return sum + file.bytes; }, 0) !== manifest.bytes) {
            throw new Error("Invalid WASM payload length");
        }
        if (manifest.gzip) checkFile(manifest.gzip);
        if (!(timeoutMs > 0) || !Number.isFinite(timeoutMs)) throw new Error("Invalid WASM timeout");
        baseURL = new URL(baseURL);

        function status(text) {
            if (!failed && typeof module.setStatus === "function") module.setStatus(text);
        }
        function progress(loaded, total) {
            status("Downloading... (" + loaded + "/" + total + ")");
        }
        function fail(error) {
            if (failed) return;
            failed = true;
            requests.forEach(function (controller) { controller.abort(); });
            if (typeof module.setStatus === "function") module.setStatus("加载失败，请刷新重试。");
            if (log && typeof log.error === "function") log.error("[Phi CF] WASM loading failed", error);
            if (!document) return;
            var spinner = document.getElementById("spinner");
            var bar = document.getElementById("progress");
            if (spinner) spinner.style.display = "none";
            if (bar) bar.hidden = true;
            if (!document.getElementById("phi-cf-wasm-retry")) {
                var button = document.createElement("button");
                button.id = "phi-cf-wasm-retry";
                button.type = "button";
                button.textContent = "刷新重试";
                button.style.pointerEvents = "auto";
                button.addEventListener("click", function () { root.location.reload(); });
                var container = document.querySelector(".loading") || document.body;
                if (container) container.appendChild(button);
            }
        }

        async function readFile(file, onProgress) {
            var controller = new root.AbortController();
            var active = true;
            var timer;
            requests.add(controller);
            var expired = new Promise(function (_, reject) {
                timer = root.setTimeout(function () {
                    var error = new Error("下载超时：" + file.url);
                    controller.abort(error);
                    reject(error);
                }, timeoutMs);
            });
            async function load() {
                var response = await fetchFile.call(root, new URL(file.url, baseURL).href, {
                    credentials: "same-origin", signal: controller.signal
                });
                if (!response.ok) throw new Error("WASM HTTP " + response.status + ": " + file.url);
                if (/text\/html/i.test(response.headers.get("content-type") || "")) {
                    throw new Error("WASM payload returned HTML: " + file.url);
                }
                var bytes;
                if (response.body && typeof response.body.getReader === "function") {
                    bytes = new Uint8Array(file.bytes);
                    var reader = response.body.getReader();
                    var offset = 0;
                    try {
                        while (true) {
                            var next = await reader.read();
                            if (next.done) break;
                            if (offset + next.value.byteLength > bytes.byteLength) {
                                throw new Error("WASM payload length mismatch: " + file.url);
                            }
                            bytes.set(next.value, offset);
                            offset += next.value.byteLength;
                            if (active) onProgress(offset);
                        }
                        if (offset !== bytes.byteLength) throw new Error("WASM payload length mismatch: " + file.url);
                    } catch (error) {
                        await reader.cancel(error).catch(function () {});
                        throw error;
                    } finally {
                        reader.releaseLock();
                    }
                } else {
                    bytes = new Uint8Array(await response.arrayBuffer());
                    if (bytes.byteLength !== file.bytes) throw new Error("WASM payload length mismatch: " + file.url);
                    if (active) onProgress(bytes.byteLength);
                }
                if (!crypto || !crypto.subtle) throw new Error("SHA-256 is unavailable");
                var digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
                var actual = Array.from(digest, function (value) { return value.toString(16).padStart(2, "0"); }).join("");
                if (actual !== file.sha256.toLowerCase()) throw new Error("WASM checksum mismatch: " + file.url);
                return bytes;
            }
            try {
                return await Promise.race([load(), expired]);
            } finally {
                active = false;
                root.clearTimeout(timer);
                controller.abort();
                requests.delete(controller);
            }
        }

        async function instantiateStream(stream, imports) {
            var response = new root.Response(stream, { headers: { "Content-Type": "application/wasm" } });
            if (typeof wasm.instantiateStreaming === "function") {
                return wasm.instantiateStreaming(response, imports);
            }
            return wasm.instantiate(await response.arrayBuffer(), imports);
        }

        async function fromGzip(imports) {
            var file = manifest.gzip;
            progress(0, file.bytes);
            var bytes = await readFile(file, function (loaded) { progress(loaded, file.bytes); });
            status("Preparing...");
            var reader = new root.Response(bytes).body.pipeThrough(new Decompress("gzip")).getReader();
            var length = 0;
            var stream = new root.ReadableStream({
                async pull(controller) {
                    try {
                        var next = await reader.read();
                        if (next.done) {
                            if (length !== manifest.bytes) throw new Error("Decompressed WASM length mismatch");
                            controller.close();
                            reader.releaseLock();
                            return;
                        }
                        length += next.value.byteLength;
                        if (length > manifest.bytes) throw new Error("Decompressed WASM length mismatch");
                        controller.enqueue(next.value);
                    } catch (error) {
                        controller.error(error);
                        await reader.cancel(error).catch(function () {});
                    }
                },
                cancel(reason) { return reader.cancel(reason); }
            });
            return instantiateStream(stream, imports);
        }

        function fromRaw(imports) {
            var index = 0;
            var loaded = 0;
            var cancelled = false;
            progress(0, manifest.bytes);
            var stream = new root.ReadableStream({
                async pull(controller) {
                    try {
                        var file = manifest.raw[index++];
                        var bytes = await readFile(file, function (partLoaded) {
                            progress(loaded + partLoaded, manifest.bytes);
                        });
                        if (cancelled) return;
                        loaded += bytes.byteLength;
                        controller.enqueue(bytes);
                        if (index === manifest.raw.length) {
                            controller.close();
                            status("Preparing...");
                        }
                    } catch (error) {
                        if (!cancelled) controller.error(error);
                    }
                },
                cancel() {
                    cancelled = true;
                    requests.forEach(function (controller) { controller.abort(); });
                }
            });
            return instantiateStream(stream, imports);
        }

        module.instantiateWasm = function (imports, success) {
            if (!state.ready) {
                state.ready = (async function () {
                    var result;
                    if (manifest.gzip && typeof Decompress === "function") {
                        try { result = await fromGzip(imports); } catch (_) { /* Verified raw parts remain available. */ }
                    }
                    if (!result) result = await fromRaw(imports);
                    status("Preparing...");
                    success(result.instance, result.module);
                    return result;
                })();
                state.ready.catch(fail);
            }
            return {};
        };
        return state;
    }

    return { install: install };
});
