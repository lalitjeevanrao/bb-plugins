import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";
import { readFileSync } from "node:fs";

const png = `data:image/png;base64,${readFileSync(new URL("./fixtures/icon.png", import.meta.url)).toString("base64")}`;
const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64")}`;

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test("a fresh install has no name and no icon", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "home-hero" });
  plugin(bb);
  assert.deepEqual(await harness.behavior.callRpc("getAppearance", null), {
    displayName: "",
    iconDataUrl: null,
  });
  await harness.lifecycle.dispose();
});

test("the greeting name comes from settings, trimmed", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "home-hero" });
  plugin(bb);
  await harness.behavior.setSettings({ displayName: "  Alex  " });
  assert.equal((await harness.behavior.callRpc("getAppearance", null)).displayName, "Alex");
  await harness.behavior.setSettings({ displayName: "" });
  assert.equal((await harness.behavior.callRpc("getAppearance", null)).displayName, "");
  await harness.lifecycle.dispose();
});

test("a valid icon is stored and read back", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "home-hero" });
  plugin(bb);
  const saved = await harness.behavior.callRpc("setIcon", { iconDataUrl: png });
  assert.equal(saved.iconDataUrl, png);
  assert.equal((await harness.behavior.callRpc("getAppearance", null)).iconDataUrl, png);
  await harness.lifecycle.dispose();
});

test("an invalid upload is rejected and the previous icon survives", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "home-hero" });
  plugin(bb);
  await harness.behavior.callRpc("setIcon", { iconDataUrl: png });
  await assert.rejects(harness.behavior.callRpc("setIcon", { iconDataUrl: svg }), /PNG, JPEG or WebP/);
  await assert.rejects(
    harness.behavior.callRpc("setIcon", { iconDataUrl: "data:image/png;base64,%%%" }),
    /base64/,
  );
  assert.equal((await harness.behavior.callRpc("getAppearance", null)).iconDataUrl, png);
  await harness.lifecycle.dispose();
});

test("a null icon removes it", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "home-hero" });
  plugin(bb);
  await harness.behavior.callRpc("setIcon", { iconDataUrl: png });
  const cleared = await harness.behavior.callRpc("setIcon", { iconDataUrl: null });
  assert.equal(cleared.iconDataUrl, null);
  assert.equal((await harness.behavior.callRpc("getAppearance", null)).iconDataUrl, null);
  await harness.lifecycle.dispose();
});

test("the icon survives a plugin reload", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "home-hero" });
  plugin(bb);
  await harness.behavior.callRpc("setIcon", { iconDataUrl: png });
  const reloaded = await harness.lifecycle.reload(plugin);
  assert.equal((await reloaded.harness.behavior.callRpc("getAppearance", null)).iconDataUrl, png);
  await reloaded.harness.lifecycle.dispose();
});

let failed = 0;
for (const { name, fn } of cases) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok ${name}\n${error.stack}`);
  }
}
process.exitCode = failed ? 1 : 0;
