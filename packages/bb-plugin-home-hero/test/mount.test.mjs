import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { HERO_ID } from "../hero.mjs";
import { mountHomeHero } from "../hero-mount.mjs";

const HOME = `<div class="mx-auto w-full max-w-[760px] px-4" id="home-column">
  <form class="group/promptbox" data-testid="root-compose-prompt"></form>
</div>`;
const COMPACT = `<div data-testid="root-compose-compact-home">
  <div class="mx-auto w-full max-w-[760px] px-4" id="compact-column">
    <form class="group/promptbox" data-testid="root-compose-compact-composer"></form>
  </div>
</div>`;
const THREAD = `<div class="mx-auto max-w-[760px]" id="thread-column"><article>thread</article></div>`;

const tick = (ms = 120) => new Promise(resolve => setTimeout(resolve, ms));

function setup(html, appearance = { displayName: "Alex", iconDataUrl: null }) {
  const dom = new JSDOM(`<body>${html}</body>`, { url: "http://localhost/" });
  const doc = dom.window.document;
  const state = { appearance, calls: 0 };
  const cleanup = mountHomeHero({
    document: doc,
    getAppearance: async () => {
      state.calls += 1;
      return state.appearance;
    },
    pollMs: 600_000,
  });
  return { doc, state, cleanup };
}

function swapBody(doc, html) {
  doc.body.innerHTML = html;
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test("mounts when a home target arrives after starting on a thread", async () => {
  const { doc, cleanup } = setup(THREAD);
  await tick();
  assert.equal(doc.getElementById(HERO_ID), null);
  assert.equal(doc.getElementById("bb-hero-style"), null);

  swapBody(doc, HOME);
  await tick();
  const hero = doc.getElementById(HERO_ID);
  assert.ok(hero, "hero attaches once the home composer appears");
  assert.equal(hero.parentElement, doc.getElementById("home-column"));
  assert.equal(doc.querySelector(".bb-hero-name").textContent, "Alex", "configured name renders");
  cleanup();
});

test("re-attaches across home -> thread -> home without an appearance change", async () => {
  const { doc, cleanup } = setup(HOME);
  await tick();
  assert.ok(doc.getElementById(HERO_ID));

  swapBody(doc, THREAD);
  await tick();
  assert.equal(doc.getElementById(HERO_ID), null, "leaving home removes the hero");
  assert.equal(doc.getElementById("bb-hero-style"), null, "and its styling");

  swapBody(doc, HOME);
  await tick();
  assert.ok(doc.getElementById(HERO_ID), "returning home restores the same appearance");
  cleanup();
});

test("handles the compact home target", async () => {
  const { doc, cleanup } = setup(COMPACT);
  await tick();
  const hero = doc.getElementById(HERO_ID);
  assert.ok(hero);
  assert.equal(hero.parentElement, doc.getElementById("compact-column"));
  cleanup();
});

test("applies a changed appearance when the home target comes back", async () => {
  const { doc, state, cleanup } = setup(HOME);
  await tick();
  assert.equal(doc.querySelector(".bb-hero-name").textContent, "Alex");

  state.appearance = { displayName: "Blair", iconDataUrl: null };
  swapBody(doc, THREAD);
  await tick();
  swapBody(doc, HOME);
  await tick();
  assert.equal(doc.querySelector(".bb-hero-name").textContent, "Blair");
  cleanup();
});

test("cleanup disconnects the observer and the poll timer", async () => {
  const { doc, cleanup } = setup(THREAD);
  await tick();
  cleanup();
  swapBody(doc, HOME);
  await tick();
  assert.equal(doc.getElementById(HERO_ID), null, "no reattach after cleanup");
});

test("a pre-aborted signal never attaches", async () => {
  const dom = new JSDOM(`<body>${THREAD}</body>`, { url: "http://localhost/" });
  const doc = dom.window.document;
  const controller = new AbortController();
  controller.abort();
  const cleanup = mountHomeHero({
    signal: controller.signal,
    document: doc,
    getAppearance: async () => ({ displayName: "Alex", iconDataUrl: null }),
    pollMs: 600_000,
  });
  swapBody(doc, HOME);
  await tick();
  assert.equal(doc.getElementById(HERO_ID), null);
  assert.equal(doc.getElementById("bb-hero-style"), null);
  cleanup();
});

for (const { name, fn } of cases) {
  await fn();
  console.log(`ok ${name}`);
}
