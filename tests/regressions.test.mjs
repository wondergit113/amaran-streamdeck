import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
function load(relative, mocks, globals = {}) {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, esModuleInterop: true },
  });
  const module = { exports: {} };
  const names = Object.keys(globals);
  new Function("require", "module", "exports", ...names, result.outputText)(
    (name) => { if (name in mocks) return mocks[name]; throw new Error("Unexpected import: " + name); },
    module, module.exports, ...Object.values(globals),
  );
  return module.exports;
}
const flush = () => new Promise(setImmediate);
function harness() {
  const requests = [], pending = [];
  let currentOn = true;
  let readFails = false;
  const sdk = {
    __esModule: true,
    default: { settings: { getGlobalSettings: async () => ({}), setGlobalSettings: async () => {} }, logger: { warn() {} } },
    action: () => (C) => C, SingletonAction: class {},
  };
  const state = load("src/state.ts", { "@elgato/streamdeck": sdk }, { setTimeout: () => 0, setInterval: () => 0 });
  const client = {
    clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v))),
    getLight: async () => { if (readFails) throw new Error("Offline"); return { on: currentOn, brightness: 50, kelvin: 5600, hue: 0, saturation: 0 }; },
    powerOn: async () => { requests.push("on"); return { on: true }; },
    powerOff: async () => { requests.push("off"); return { on: false }; },
    setBrightness: async (_settings, _id, value) => new Promise((resolve, reject) => {
      requests.push(value); pending.push({ resolve: (brightness = value) => resolve({ on: true, brightness }), reject });
    }),
  };
  const deps = { "@elgato/streamdeck": sdk, "../client": client, "../state": state };
  const { BrightnessDial } = load("src/actions/brightness-dial.ts", deps);
  const { ToggleLight } = load("src/actions/toggle.ts", deps);
  let saved = { lightId: "test", level: 50, isOn: false };
  let alerts = 0;
  const action = {
    id: "test-context", isKey: () => true, isDial: () => true,
    setImage: async () => {}, setFeedback: async () => {}, setFeedbackLayout: async () => {},
    setSettings: async (settings) => { saved = { ...settings }; },
    getSettings: async () => ({ ...saved }), showAlert: async () => { alerts++; },
  };
  return {
    state, action, dial: new BrightnessDial(), toggle: new ToggleLight(), requests, pending,
    event: (extra = {}) => ({ action, payload: { settings: { ...saved }, ...extra } }),
    saved: () => saved, alerts: () => alerts,
    setOn: (on) => { currentOn = on; }, failReads: () => { readFails = true; },
    setMode: (mode) => { saved.mode = mode; },
  };
}
test("rapid brightness changes preserve the final target", async () => {
  const h = harness(); h.state.setLevelSync("test", 50);
  await h.dial.onDialRotate(h.event({ ticks: 1 }));
  await h.dial.onDialRotate(h.event({ ticks: 1 }));
  h.pending.shift().resolve(); await flush();
  assert.deepEqual(h.requests, [54, 58]);
  h.pending.shift().resolve(); await flush();
  assert.equal(h.saved().level, 58);
});
test("a burst drops intermediate requests but not the newest one", async () => {
  const h = harness(); h.state.setLevelSync("test", 50);
  for (let i = 0; i < 3; i++) await h.dial.onDialRotate(h.event({ ticks: 1 }));
  h.pending.shift().resolve(); await flush();
  assert.deepEqual(h.requests, [54, 62]);
  h.pending.shift().resolve(); await flush();
  assert.equal(h.saved().level, 62);
});
test("a failed brightness request does not strand the next target", async () => {
  const h = harness(); h.state.setLevelSync("test", 50);
  await h.dial.onDialRotate(h.event({ ticks: 1 }));
  await h.dial.onDialRotate(h.event({ ticks: 1 }));
  h.pending.shift().reject(new Error("Offline")); await flush();
  assert.deepEqual(h.requests, [54, 58]);
  h.pending.shift().resolve(); await flush();
  assert.equal(h.saved().level, 58);
});
test("toggle appearance persists the state it displays", async () => {
  const h = harness();
  await h.toggle.onWillAppear(h.event());
  assert.equal(h.saved().isOn, true);
  await h.toggle.onKeyDown(h.event());
  assert.deepEqual(h.requests, ["off"]);
});
test("toggle checks current state instead of a stale saved flag", async () => {
  const h = harness();
  await h.toggle.onKeyDown(h.event());
  assert.deepEqual(h.requests, ["off"]);
});
test("toggle does not guess when the state endpoint is unavailable", async () => {
  const h = harness(); h.failReads();
  await h.toggle.onKeyDown(h.event());
  assert.deepEqual(h.requests, []);
  assert.equal(h.alerts(), 1);
});
for (const mode of ["on", "off"]) test("explicit " + mode + " remains available without a state read", async () => {
  const h = harness(); h.setMode(mode); h.failReads();
  await h.toggle.onKeyDown(h.event());
  assert.deepEqual(h.requests, [mode]);
});
test("HTTP reads and writes have bounded deadlines", async () => {
  const requests = [];
  const client = load("src/client.ts", {}, { fetch: async (url, options) => {
    requests.push({ url, options }); return { ok: true, json: async () => ({ state: { on: true, brightness: 50 } }) };
  } });
  await client.getLight({}, "test");
  await client.powerOn({}, "test");
  assert.equal(requests.length, 2);
  for (const { options } of requests) assert.ok(options.signal instanceof AbortSignal);
});

test("an older response cannot repaint a newer target", async () => {
  const h = harness(); h.state.setLevelSync("test", 50);
  await h.dial.onDialRotate(h.event({ ticks: 1 }));
  await h.dial.onDialRotate(h.event({ ticks: 1 }));
  h.pending.shift().resolve(10); await flush();
  assert.equal(h.state.getLevelSync("test"), 58);
  assert.equal(h.saved().level, 58);
  assert.deepEqual(h.requests, [54, 58]);
  h.pending.shift().resolve(57); await flush();
  assert.equal(h.saved().level, 57);
});

test("invalid state reads fail instead of inventing a toggle state", async () => {
  for (const data of [{}, { state: {} }, { state: { on: "false", brightness: 50 } }]) {
    const client = load("src/client.ts", {}, { fetch: async () => ({ ok: true, json: async () => data }) });
    await assert.rejects(client.getLight({}, "test"), /valid state/);
  }
});

test("GET and POST use seven-second deadlines and propagate aborts", async () => {
  const deadlines = [];
  const client = load("src/client.ts", {}, {
    AbortSignal: { timeout: (ms) => { deadlines.push(ms); return { aborted: true }; } },
    fetch: async (_url, { signal }) => {
      assert.equal(signal.aborted, true);
      throw new DOMException("Timed out", "TimeoutError");
    },
  });
  await assert.rejects(client.getLight({}, "test"), { name: "TimeoutError" });
  await assert.rejects(client.setBrightness({}, "test", 58), { name: "TimeoutError" });
  assert.deepEqual(deadlines, [7000, 7000]);
});
