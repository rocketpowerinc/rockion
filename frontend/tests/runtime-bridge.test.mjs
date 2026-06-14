import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { hasWailsRuntime } from "../src/runtimeBridge.mjs";

test("plain browsers are not mistaken for the Wails runtime", () => {
  assert.equal(hasWailsRuntime({}), false);
  assert.equal(hasWailsRuntime({ runtime: {} }), false);
  assert.equal(hasWailsRuntime({ go: { main: { App: {} } } }), false);
  assert.equal(
    hasWailsRuntime({ runtime: {}, go: { main: { App: {} } } }),
    true
  );
});

test("runtime-only theme and event calls are guarded for browser preview", () => {
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const welcome = fs.readFileSync(
    new URL("../src/components/WelcomeDashboard.tsx", import.meta.url),
    "utf8"
  );
  assert.match(api, /if \(!hasWailsRuntime\(\)\) return/);
  assert.match(api, /hasWailsRuntime\(\) \? EventsOn/);
  assert.match(app, /nativeRuntime=\{nativeRuntime\}/);
  assert.match(welcome, /Browser preview mode/);
  assert.match(welcome, /disabled=\{!nativeRuntime\}/);
});

test("the sidebar home button closes the active vault before showing the landing page", () => {
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const sidebar = fs.readFileSync(
    new URL("../src/components/Sidebar.tsx", import.meta.url),
    "utf8"
  );

  assert.match(api, /closeVault: \(\): Promise<void> => App\.CloseVault\(\)/);
  assert.match(app, /await api\.closeVault\(\)/);
  assert.match(app, /setVault\(null\)/);
  assert.match(sidebar, /aria-label="Back to vault home"/);
});
