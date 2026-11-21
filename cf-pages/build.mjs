import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const wasmName = 'PhigrosLoader_sample.wasm';
const limit = 25 * 1024 * 1024;
const chunkSize = 8 * 1024 * 1024;
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const wasm = await readFile(path.join(root, wasmName));
assert.deepEqual([...wasm.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0], 'Invalid WebAssembly file');
const manifest = { version: 1, bytes: wasm.length, sha256: digest(wasm), raw: [] };
const files = new Map();
for (let offset = 0, part = 0; offset < wasm.length; offset += chunkSize, part++) {
  const bytes = wasm.subarray(offset, offset + chunkSize);
  const name = 'wasm/' + manifest.sha256 + '.part-' + String(part).padStart(3, '0') + '.bin';
  files.set(name, bytes);
  manifest.raw.push({ url: name, bytes: bytes.length, sha256: digest(bytes) });
}
const compressed = gzipSync(wasm, { level: 9 });
assert.deepEqual(gunzipSync(compressed), wasm, 'Compressed WASM did not round-trip');
// Preserve raw chunks as a compatibility path, including for future releases
// whose compressed WASM might itself exceed the Pages asset limit.
if (compressed.length < limit) {
  const sha256 = digest(compressed);
  const url = 'wasm/' + sha256 + '.wasm.gz.bin';
  manifest.gzip = { url, bytes: compressed.length, sha256 };
  files.set(url, compressed);
}
assert.equal(digest(Buffer.concat(manifest.raw.map(part => files.get(part.url)))), manifest.sha256);

const loaderSource = await readFile(path.join(root, 'cf-pages/wasm-loader.js'), 'utf8');
const loader = Buffer.from('globalThis.__PhiCFWasmManifest=' + JSON.stringify(manifest) + ';\n' + loaderSource);
const loaderName = 'cf-wasm-loader.' + digest(loader).slice(0, 20) + '.js';
files.set(loaderName, loader);
files.set('cf-wasm.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));

// Only runtime assets enter dist. Build sources and the original large WASM
// remain in Git so subsequent releases can be rebuilt without manual splitting.
const runtimeExtension = /\.(?:js|html|json|xml|data|unx|txt)$/i;
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isFile() || entry.name === wasmName || entry.name === 'runner-sw.js' || !runtimeExtension.test(entry.name)) continue;
  files.set(entry.name, await readFile(path.join(root, entry.name)));
}
async function copyResourceFiles(directory, prefix = 'resource') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Resource symlinks are not supported');
    const name = prefix + '/' + entry.name;
    if (entry.isDirectory()) await copyResourceFiles(path.join(directory, entry.name), name);
    else if (entry.isFile()) files.set(name, await readFile(path.join(directory, entry.name)));
  }
}
await copyResourceFiles(path.join(root, 'resource'));
for (const name of ['LICENSE', '.nojekyll']) {
  try { files.set(name, await readFile(path.join(root, name))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// Patch entry points, not the generated runtime JS or binary itself.
const wasmAssets = [...manifest.raw.map(part => part.url), ...(manifest.gzip ? [manifest.gzip.url] : []), loaderName];
for (const [name, bytes] of files) {
  if (!name.endsWith('.html')) continue;
  let html = bytes.toString('utf8');
  if (/src="(?:PhigrosLoader_sample|runner)\.js"/.test(html)) {
    html = html.replace(/(<script\b[^>]*\bsrc=")(?:PhigrosLoader_sample|runner)\.js("[^>]*><\/script>)/,
      '<script src="' + loaderName + '"></script>\n$1PhigrosLoader_sample.js$2');
  }
  files.set(name, Buffer.from(html));
}
// The legacy runner shell has no GX bridges. Serve the complete static shell
// at that URL too, instead of publishing an entry point that cannot boot.
files.set('runner.html', files.get('index.html'));
const runner = JSON.parse(files.get('runner.json').toString('utf8'));
// HTML must not hash itself; this cache manifest only lists runtime resources.
runner.manifestFiles = runner.manifestFiles.filter(name => !name.endsWith('.html'))
  .flatMap(name => name === wasmName ? wasmAssets : name);
runner.manifestFilesMD5 = runner.manifestFiles.map(name => {
  assert(files.has(name), 'Missing runner asset: ' + name);
  return digest(files.get(name), 'md5');
});
files.set('runner.json', Buffer.from(JSON.stringify(runner, null, 2) + '\n'));
for (const [name, bytes] of files) {
  if (!name.endsWith('.html')) continue;
  let html = bytes.toString('utf8');
  html = html.replace(/function manifestFiles\(\)\s*\{[\s\S]*?\n\s*\}/,
    'function manifestFiles() { return ' + JSON.stringify(runner.manifestFiles.join(';')) + '; }');
  html = html.replace(/function manifestFilesMD5\(\)\s*\{[\s\S]*?\n\s*\}/,
    'function manifestFilesMD5() { return ' + JSON.stringify(runner.manifestFilesMD5) + '; }');
  files.set(name, Buffer.from(html));
}
// Separate the legacy SW cache namespace from the previous GameMaker build.
if (files.has('sw.js')) {
  const cacheKey = digest(Buffer.from([...files].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, bytes]) => name + ':' + digest(bytes)).join('\n')));
  let sw = files.get('sw.js').toString('utf8');
  sw = sw.replace(/const GAME_VERSION = [^;]+;/, 'const GAME_VERSION = "cf-' + cacheKey.slice(0, 20) + '";');
  sw = sw.replace(/const CACHE_FILES = \[[\s\S]*?\];/, 'const CACHE_FILES = ' + JSON.stringify(runner.manifestFiles) + ';');
  files.set('sw.js', Buffer.from(sw));
}
const build = JSON.parse(files.get('gx-build.json').toString('utf8'));
build.cfPages = { sourceWasm: { name: wasmName, bytes: manifest.bytes, sha256: manifest.sha256 }, manifest: 'cf-wasm.json', loader: loaderName };
delete build.files[wasmName];
for (const name of [...Object.keys(build.files), ...wasmAssets, 'cf-wasm.json']) {
  assert(files.has(name), 'Missing manifest asset: ' + name);
  build.files[name] = digest(files.get(name));
}
files.set('gx-build.json', Buffer.from(JSON.stringify(build, null, 2) + '\n'));
files.set('_headers', Buffer.from([
  '/wasm/*',
  '  Content-Type: application/octet-stream',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/cf-wasm-loader.*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/*',
  '  X-Content-Type-Options: nosniff',
  '',
].join('\n')));

for (const [name, bytes] of files) {
  assert(bytes.length < limit, 'Asset exceeds the 25 MiB Pages limit: ' + name);
  assert(name !== wasmName, 'Original oversized WASM entered the output');
}
// dist is the sole generated directory this command owns and replaces.
assert.equal(path.dirname(output), root);
try {
  const previous = await lstat(output);
  assert(previous.isDirectory() && !previous.isSymbolicLink(), 'Refusing to replace non-directory dist');
  await rm(output, { recursive: true });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(output);
for (const [name, bytes] of files) {
  const destination = path.join(output, name);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}
console.log(JSON.stringify({ output: 'dist', files: files.size, wasmBytes: manifest.bytes,
  gzipBytes: manifest.gzip?.bytes ?? null, rawParts: manifest.raw.length,
  largestAsset: Math.max(...[...files.values()].map(bytes => bytes.length)), sha256: manifest.sha256 }, null, 2));
