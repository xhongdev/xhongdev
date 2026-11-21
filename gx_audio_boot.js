/**
 * GX.games audio boot. Inlined into runner HTML so OGG playback does not
 * depend on gx_drop.js resolving next to runner.html.
 */
(function (g) {
    "use strict";
    if (!g || g.__plsAudioBoot) return;
    g.__plsAudioBoot = 1;
    function bind(name, fn) {
        g[name] = fn;
        try { if (typeof Da !== "undefined" && Da) Da[name] = fn; } catch (e0) {}
        try { if (typeof window !== "undefined") window[name] = fn; } catch (e1) {}
    }
    var ctx = null;
    var nextId = 1;
    var slots = {};
    var lastErr = "";
    var pageHidden = 0;
    function newSlot(id, mime) {
        return { id: id, mime: String(mime || "audio/ogg"), parts: [], total: 0,
            off: 0, dur: 0, playing: 0, want: 0, released: false, decodeToken: 0,
            lowpassEnabled: false, lowpassCutoff: 22000 };
    }
    function live(s) {
        return !!s && !s.released && slots[s.id] === s;
    }
    function disconnect(node) {
        if (node) try { node.disconnect(); } catch (e0) {}
    }
    function AC() {
        try {
            if (!ctx) {
                var C = g.AudioContext || g.webkitAudioContext;
                if (!C) {
                    lastErr = "no AudioContext";
                    return null;
                }
                ctx = new C();
            }
            if (ctx.state === "suspended") ctx.resume();
            return ctx;
        } catch (e) {
            lastErr = "AudioContext failed";
            return null;
        }
    }
    function unlock() {
        AC();
        var ids = Object.keys(slots);
        for (var i = 0; i < ids.length; i++) {
            var s = slots[ids[i]];
            if (!s) continue;
            if (pageHidden) continue;
            if (s.el && s.want) {
                playEl(s);
            } else if (s.want && s.buffer && !s.playing) {
                playBuf(s);
            }
        }
    }
    function mimeFromPath(p) {
        p = String(p || "").split("?")[0].toLowerCase();
        if (p.indexOf("data:audio/") === 0) {
            var sc = p.indexOf(";");
            return sc > 0 ? p.slice(5, sc) : "audio/ogg";
        }
        if (p.slice(-4) === ".ogg" || p.slice(-4) === ".oga" || p.slice(-5) === ".opus") return "audio/ogg";
        if (p.slice(-4) === ".mp3") return "audio/mpeg";
        if (p.slice(-4) === ".wav" || p.slice(-5) === ".wave") return "audio/wav";
        if (p.slice(-5) === ".flac") return "audio/flac";
        if (p.slice(-4) === ".m4a") return "audio/mp4";
        if (p.slice(-4) === ".aac") return "audio/aac";
        return "audio/ogg";
    }
    function pauseAll() {
        var ids = Object.keys(slots);
        for (var i = 0; i < ids.length; i++) {
            var s = slots[ids[i]];
            if (!s) continue;
            if (s.el) {
                s.want = s.want || !s.el.paused ? 1 : 0;
                try { s.el.pause(); } catch (e0) {}
            } else {
                s.want = s.want || s.playing ? 1 : 0;
                s.off = posOf(s);
                s.playing = 0;
                stopSrc(s);
            }
        }
        if (ctx && ctx.state === "running") {
            try { ctx.suspend(); } catch (e1) {}
        }
    }
    function onPageHidden(hidden) {
        hidden = hidden || !!(g.PhiGX && g.PhiGX.suspended());
        pageHidden = hidden ? 1 : 0;
        if (hidden) pauseAll();
        else {
            if (ctx && ctx.state === "suspended") {
                try { ctx.resume(); } catch (e2) {}
            }
            unlock();
        }
    }
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", function () {
            onPageHidden(!!document.hidden);
        }, true);
        document.addEventListener("pls-gx-fullscreen", function (ev) { onPageHidden(document.hidden || ev.detail.suspended); });
        document.addEventListener("pagehide", function () { onPageHidden(true); }, true);
        document.addEventListener("pageshow", function () { onPageHidden(false); }, true);
        document.addEventListener("freeze", function () { onPageHidden(true); }, true);
        document.addEventListener("resume", function () { onPageHidden(false); }, true);
        document.addEventListener("pointerdown", unlock, true);
        document.addEventListener("keydown", unlock, true);
    }
    function b64u8(b64) {
        var bin = atob(String(b64 || ""));
        var u = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i) & 255;
        return u;
    }
    function stopSrc(s) {
        if (!s || !s.src) return;
        try { s.src.onended = null; s.src.stop(); } catch (e0) {}
        try { s.src.disconnect(); } catch (e1) {}
        s.src = null;
    }
    function posOf(s) {
        if (!s) return 0;
        if (!s.playing || !ctx) return s.off || 0;
        var p = (s.off || 0) + (ctx.currentTime - s.t0);
        if (s.dur && p > s.dur) p = s.dur;
        return p < 0 ? 0 : p;
    }
    // Each music slot owns this graph. Neither the Runner's master audio nor
    // other slots (including hit sounds) pass through its filter or gain.
    function ensureGraph(s) {
        if (!live(s)) return 0;
        if (s.input && s.gain) return 1;
        var c = AC();
        if (!c) return 0;
        var input = null, gain = null;
        try {
            input = c.createGain();
            input.gain.value = 1;
            gain = c.createGain();
            gain.gain.value = s.volume === undefined ? 1 : s.volume;
            input.connect(gain);
            gain.connect(c.destination);
            s.input = input;
            s.gain = gain;
            return 1;
        } catch (e0) {
            disconnect(input);
            disconnect(gain);
            lastErr = "audio graph failed";
            return 0;
        }
    }
    function ensureElementGraph(s) {
        if (!live(s) || !s.el) return 0;
        if (s.mediaConnected) return 1;
        if (!ensureGraph(s)) return 0;
        try {
            if (!s.mediaSource) s.mediaSource = ctx.createMediaElementSource(s.el);
            s.mediaSource.connect(s.input);
            s.mediaConnected = true;
            // MediaElementSource retains the element's volume. Apply volume
            // once in the slot gain, just like decoded-buffer playback.
            s.el.volume = 1;
            return 1;
        } catch (e0) {
            lastErr = "audio element graph failed";
            return 0;
        }
    }
    function routeLowpass(s, enabled) {
        if (s.lowpassEnabled === enabled) return 1;
        try {
            if (enabled) {
                s.filter.connect(s.gain);
                s.input.disconnect();
                s.input.connect(s.filter);
            } else {
                s.input.disconnect();
                disconnect(s.filter);
                s.input.connect(s.gain);
            }
            s.lowpassEnabled = enabled;
            return 1;
        } catch (e0) {
            disconnect(s.input);
            disconnect(s.filter);
            try { s.input.connect(s.gain); } catch (e1) {}
            s.lowpassEnabled = false;
            lastErr = "audio lowpass routing failed";
            return 0;
        }
    }
    function resetLowpass(s) {
        var ok = routeLowpass(s, false);
        s.lowpassCutoff = 22000;
        if (s.filter && ctx) s.filter.frequency.value = Math.min(22000, ctx.sampleRate / 2);
        return ok;
    }
    function playEl(s) {
        if (!live(s) || !s.el) return 0;
        // Keep direct HTMLAudio playback when Web Audio is unavailable.
        // If a context becomes available later, adopt the same private graph.
        ensureElementGraph(s);
        var p = s.el.play();
        if (p && p.catch) p.catch(function () {});
        return 1;
    }
    function playBuf(s) {
        if (!live(s)) return 0;
        if (pageHidden || (g.PhiGX && g.PhiGX.suspended())) { s.want = 1; return 1; }
        var c = AC();
        if (!c || !s.buffer) {
            s.want = 1;
            return 1;
        }
        if (!ensureGraph(s)) return 0;
        stopSrc(s);
        var src = c.createBufferSource();
        src.buffer = s.buffer;
        src.connect(s.input);
        s.off = s.off || 0;
        try { src.start(0, s.off); } catch (e0) {
            try { src.start(0); } catch (e1) {}
        }
        s.src = src;
        s.t0 = c.currentTime;
        s.playing = 1;
        s.want = 0;
        src.onended = function () {
            if (live(s) && s.src === src) {
                s.playing = 0;
                s.off = s.dur || 0;
            }
        };
        return 1;
    }
    function attachEl(s, u8, mime) {
        if (!live(s)) return 0;
        try {
            var blob = new Blob([u8], { type: mime || "audio/ogg" });
            var url = URL.createObjectURL(blob);
            var el = new Audio();
            el.volume = s.volume === undefined ? 1 : s.volume;
            el.preload = "auto";
            el.src = url;
            el.__plsObjectUrl = url;
            s.el = el;
            ensureElementGraph(s);
            s.metadataHandler = function () {
                if (!live(s) || s.el !== el) return;
                s.dur = isFinite(el.duration) ? el.duration : 0;
                if (s.off > 0) try { el.currentTime = s.off; } catch (seekError) {}
                if (s.want && !pageHidden && !(g.PhiGX && g.PhiGX.suspended())) playEl(s);
            };
            el.addEventListener("loadedmetadata", s.metadataHandler);
            try { el.load(); } catch (e0) {}
            return 1;
        } catch (e1) {
            lastErr = "element failed";
            return 0;
        }
    }
    function decodeU8(s, u8, mime) {
        if (!live(s)) return 0;
        var token = ++s.decodeToken;
        var c = AC();
        if (!c) return attachEl(s, u8, mime);
        var ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        function decoded(buf) {
            if (!live(s) || s.decodeToken !== token) return;
            s.buffer = buf;
            s.dur = buf.duration || 0;
            if (s.want) playBuf(s);
        }
        function fallback() {
            if (!live(s) || s.decodeToken !== token) return 0;
            lastErr = "ogg decode failed";
            return attachEl(s, u8, mime);
        }
        try {
            var p = c.decodeAudioData(ab);
            if (p && p.then) {
                p.then(decoded, fallback);
                return 1;
            }
        } catch (e0) {}
        try { c.decodeAudioData(ab, decoded, fallback); }
        catch (e1) { return fallback(); }
        return 1;
    }
    bind("i_gx_audio_begin", function (mime) {
        lastErr = "";
        var id = nextId++;
        slots[id] = newSlot(id, mime);
        return id;
    });
    bind("i_gx_audio_append", function (id, b64) {
        var s = slots[id | 0];
        if (!s) {
            lastErr = "append";
            return 0;
        }
        var u = b64u8(b64);
        if (u.length) {
            s.parts.push(u);
            s.total += u.length;
        }
        return 1;
    });
    bind("i_gx_audio_end", function (id) {
        var s = slots[id | 0];
        if (!s) {
            lastErr = "end";
            return 0;
        }
        var u = new Uint8Array(s.total);
        var o = 0;
        for (var i = 0; i < s.parts.length; i++) {
            u.set(s.parts[i], o);
            o += s.parts[i].length;
        }
        s.parts = [];
        if (!u.length) {
            lastErr = "empty";
            return 0;
        }
        return decodeU8(s, u, s.mime);
    });
    bind("i_gx_audio_create", function (path) {
        lastErr = "";
        var p = String(path || "");
        var id = nextId++;
        var s = slots[id] = newSlot(id, mimeFromPath(p));
        if (p.indexOf("http://") === 0 || p.indexOf("https://") === 0 || p.indexOf("blob:") === 0 || p.indexOf("data:") === 0) {
            try {
                fetch(p).then(function (r) {
                    return live(s) ? r.arrayBuffer() : null;
                }).then(function (ab) {
                    if (live(s) && ab) decodeU8(s, new Uint8Array(ab), s.mime);
                }).catch(function () { if (live(s)) lastErr = "fetch failed"; });
                return id;
            } catch (e0) {}
        }
        lastErr = "path needs bytes";
        return 0;
    });
    bind("i_gx_audio_set_volume", function (id, volume) {
        var s = slots[id | 0];
        if (!s) return 0;
        s.volume = Math.max(0, Math.min(1, Number(volume)));
        if (!isFinite(s.volume)) s.volume = 1;
        if (s.el) s.el.volume = s.mediaConnected ? 1 : s.volume;
        if (s.gain) s.gain.gain.value = s.volume;
        return 1;
    });
    bind("i_gx_audio_set_lowpass", function (id, cutoffHz, enabled) {
        var s = slots[id | 0];
        if (!live(s)) return 0;
        var frequency = Number(cutoffHz);
        if (!isFinite(frequency) || frequency <= 0) {
            lastErr = "audio lowpass cutoff invalid";
            return 0;
        }
        var active = Number(enabled) > 0;
        if (!active) {
            if (!routeLowpass(s, false)) return 0;
            s.lowpassCutoff = frequency;
            lastErr = "";
            return 1;
        }
        if (!ensureGraph(s)) return 0;
        if (s.el && !ensureElementGraph(s)) return 0;
        frequency = Math.min(frequency, ctx.sampleRate / 2);
        try {
            if (!s.filter) {
                var filter = ctx.createBiquadFilter();
                filter.type = "lowpass";
                // Web Audio expresses lowpass Q in dB, unlike FMOD's linear Q.
                // 20*log10(sqrt(0.5)) gives the same Butterworth response.
                filter.Q.value = -3.010299956639812;
                s.filter = filter;
            }
            s.filter.frequency.value = frequency;
        } catch (e0) {
            lastErr = "audio lowpass unavailable";
            return 0;
        }
        s.lowpassCutoff = frequency;
        if (!routeLowpass(s, true)) return 0;
        lastErr = "";
        return 1;
    });
    bind("i_gx_audio_play", function (id) {
        var s = slots[id | 0];
        if (!s) return 0;
        s.want = 1;
        if (pageHidden || (g.PhiGX && g.PhiGX.suspended())) return 1;
        if (s.el) return playEl(s);
        s.want = 1;
        return playBuf(s);
    });
    bind("i_gx_audio_pause", function (id) {
        var s = slots[id | 0];
        if (!s) return 0;
        s.want = 0;
        if (s.el) {
            s.el.pause();
            return 1;
        }
        s.off = posOf(s);
        s.playing = 0;
        stopSrc(s);
        return 1;
    });
    bind("i_gx_audio_resume", function (id) {
        var s = slots[id | 0];
        if (!s) return 0;
        s.want = 1;
        if (pageHidden || (g.PhiGX && g.PhiGX.suspended())) return 1;
        if (s.el) return playEl(s);
        s.want = 1;
        return playBuf(s);
    });
    bind("i_gx_audio_stop", function (id) {
        var s = slots[id | 0];
        if (!s) return 0;
        s.want = 0;
        s.off = 0;
        s.playing = 0;
        if (s.el) {
            s.el.pause();
            try { s.el.currentTime = 0; } catch (e0) {}
        }
        stopSrc(s);
        return resetLowpass(s);
    });
    bind("i_gx_audio_set_position_ms", function (id, ms) {
        var s = slots[id | 0];
        if (!s) return 0;
        var sec = Math.max(0, Number(ms) / 1000);
        s.off = sec;
        if (s.el) {
            try { s.el.currentTime = sec; } catch (e0) {}
            return 1;
        }
        if (s.playing) playBuf(s);
        return 1;
    });
    bind("i_gx_audio_get_position_ms", function (id) {
        var s = slots[id | 0];
        if (!s) return 0;
        if (s.el) return (s.el.currentTime || 0) * 1000;
        return posOf(s) * 1000;
    });
    bind("i_gx_audio_get_length_ms", function (id) {
        var s = slots[id | 0];
        if (!s) return 0;
        if (s.el) {
            var d = s.el.duration;
            return isFinite(d) ? d * 1000 : 0;
        }
        return (s.dur || 0) * 1000;
    });
    bind("i_gx_audio_release", function (id) {
        var s = slots[id | 0];
        if (!s) return 0;
        // Invalidate before stopping nodes: late decode/fetch/metadata callbacks
        // must neither restart playback nor create a replacement graph.
        s.released = true;
        s.want = 0;
        s.playing = 0;
        s.decodeToken++;
        delete slots[id | 0];
        stopSrc(s);
        disconnect(s.mediaSource);
        disconnect(s.input);
        disconnect(s.filter);
        disconnect(s.gain);
        if (s.el) {
            if (s.metadataHandler) s.el.removeEventListener("loadedmetadata", s.metadataHandler);
            try { s.el.pause(); s.el.removeAttribute("src"); s.el.load(); } catch (e0) {}
            if (s.el.__plsObjectUrl) {
                try { URL.revokeObjectURL(s.el.__plsObjectUrl); } catch (e1) {}
            }
        }
        s.mediaSource = null;
        s.input = null;
        s.filter = null;
        s.gain = null;
        s.el = null;
        s.buffer = null;
        s.parts = [];
        return 1;
    });
    bind("i_gx_audio_last_error", function () { return lastErr || ""; });
    bind("i_gx_audio_ping", function () { return 1; });
    bind("i_gx_page_hidden", function () { return pageHidden; });
})(typeof globalThis !== "undefined" ? globalThis : window);
