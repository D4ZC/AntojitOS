import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../apps/pos/public/sw.js", import.meta.url), "utf8");
const worker = (fetch, { failCacheWrite = false } = {}) => {
  const listeners = {};
  const stored = new Map([["/", new Response("old POS")]]);
  const deleted = [];
  const cache = { put: async (key, response) => {
    if (failCacheWrite) throw new Error("quota exceeded");
    stored.set(typeof key === "string" ? key : key.url, response);
  }, addAll: async () => {} };
  const self = { location: { origin: "http://localhost:8080" }, clients: { claim: async () => {} }, skipWaiting() {}, addEventListener: (name, handler) => { listeners[name] = handler; } };
  runInNewContext(source, {
    self, URL, Response, Promise, fetch,
    caches: { keys: async () => ["antojit-os-shell-v2", "other-app", "antojit-os-shell-v3"], delete: async key => deleted.push(key), open: async () => cache, match: async key => stored.get(typeof key === "string" ? key : key.url) },
  });
  const request = async (path, mode = "navigate") => {
    let result;
    listeners.fetch({ request: { url: self.location.origin + path, method: "GET", mode }, respondWith: promise => { result = promise; } });
    return result;
  };
  return { listeners, stored, deleted, request };
};

test("KDS navigation fetches current HTML even when the old page is cached", async () => {
  const w = worker(async (_request, options) => {
    assert.equal(options.cache, "no-store");
    return new Response("current KDS");
  });
  w.stored.set("http://localhost:8080/?mode=kds", new Response("old POS"));
  assert.equal(await (await w.request("/?mode=kds")).text(), "current KDS");
  assert.equal(await w.stored.get("/").text(), "current KDS");
});

test("offline navigation falls back to the saved shell", async () => {
  const w = worker(async () => { throw new Error("offline"); });
  assert.equal(await (await w.request("/kds/")).text(), "old POS");
});

test("a full cache does not replace the current page with the old screen", async () => {
  const w = worker(async () => new Response("current KDS"), { failCacheWrite: true });
  assert.equal(await (await w.request("/kds/")).text(), "current KDS");
});

test("an expired shell is removed without deleting another application's cache", async () => {
  const w = worker(async () => new Response("ok"));
  let activated;
  w.listeners.activate({ waitUntil: promise => { activated = promise; } });
  await activated;
  assert.deepEqual(w.deleted, ["antojit-os-shell-v2"]);
});

test("API requests never fall back to cached data", async () => {
  const w = worker(async () => { throw new Error("offline API"); });
  w.stored.set("http://localhost:8080/api/production/tickets", new Response("stale orders"));
  await assert.rejects(w.request("/api/production/tickets", "cors"), /offline API/);
});

test("recovery removes the old worker and shell, preserving terminal credentials", async () => {
  const html = readFileSync(new URL("../apps/pos/public/recuperar-cocina.html", import.meta.url), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const deleted = [];
  let unregistered = false;
  let next;
  await runInNewContext(script, {
    navigator: { serviceWorker: { getRegistration: async () => ({ unregister: async () => { unregistered = true; } }) } },
    window: { caches: true },
    caches: { keys: async () => ["antojit-os-shell-v2", "another-cache"], delete: async key => deleted.push(key) },
    location: { replace: url => { next = url; } },
    Date, Promise,
    // Any attempt to clear stored terminal credentials must fail this test.
    localStorage: new Proxy({}, { get() { throw new Error("terminal credentials were accessed"); } }),
  });
  assert.equal(unregistered, true);
  assert.deepEqual(deleted, ["antojit-os-shell-v2"]);
  assert.match(next, /^\/kds\/\?v=\d+$/);
});
