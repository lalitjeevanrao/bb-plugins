import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { DEFAULT_GREETING_FONT, formatGreeting } from "../greeting.ts";
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
const greeting = doc => doc.querySelector(".bb-hero-greeting");
const entranceEffect = doc => doc.getElementById(HERO_ID).getAttribute("data-bb-hero-effect");

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
  assert.match(greeting(doc).textContent, /, Alex$/);
  cleanup();
});

test("picks a new greeting, font, and effect across home -> thread -> home", async () => {
  const { doc, cleanup } = setup(HOME);
  try {
    await tick();
    assert.ok(doc.getElementById(HERO_ID));
    const first = greeting(doc);
    const firstEffect = entranceEffect(doc);
    assert.ok(firstEffect);

    swapBody(doc, THREAD);
    await tick();
    assert.equal(doc.getElementById(HERO_ID), null, "leaving home removes the hero");
    assert.equal(doc.getElementById("bb-hero-style"), null, "and its styling");

    swapBody(doc, HOME);
    await tick();
    assert.notEqual(greeting(doc).textContent, first.textContent);
    assert.notEqual(greeting(doc).style.fontFamily, first.style.fontFamily);
    assert.ok(entranceEffect(doc));
    assert.notEqual(entranceEffect(doc), firstEffect);
  } finally {
    cleanup();
  }
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
  assert.match(greeting(doc).textContent, /, Alex$/);

  state.appearance = { displayName: "Blair", iconDataUrl: null };
  swapBody(doc, THREAD);
  await tick();
  swapBody(doc, HOME);
  await tick();
  assert.match(greeting(doc).textContent, /, Blair$/);
  cleanup();
});

test("each switch applies independently and preserves the other choice", async () => {
  const { doc, state, cleanup } = setup(HOME);
  try {
    Object.defineProperty(doc, "visibilityState", { value: "visible" });
    const refresh = async changes => {
      Object.assign(state.appearance, changes);
      doc.dispatchEvent(new doc.defaultView.Event("visibilitychange"));
      await tick();
    };
    await tick();
    const initial = greeting(doc);
    const initialEffect = entranceEffect(doc);
    assert.ok(initialEffect);
    await refresh({});
    assert.equal(greeting(doc), initial, "refreshing the same appearance leaves the greeting mounted");
    assert.equal(entranceEffect(doc), initialEffect);

    await refresh({ randomizeFont: false });
    const probe = doc.createElement("div");
    probe.style.fontFamily = DEFAULT_GREETING_FONT;
    assert.equal(greeting(doc).style.fontFamily, probe.style.fontFamily);
    assert.equal(greeting(doc).textContent, initial.textContent);

    await refresh({ randomizeFont: true, randomizeGreeting: false });
    assert.equal(greeting(doc).style.fontFamily, initial.style.fontFamily);
    const fixedGreeting = formatGreeting(new Date().getHours(), "Alex");
    assert.equal(greeting(doc).textContent, fixedGreeting);
    assert.equal(entranceEffect(doc), initialEffect);

    await refresh({ animateGreeting: false });
    assert.equal(entranceEffect(doc), null);
    assert.equal(greeting(doc).textContent, fixedGreeting);
    assert.equal(greeting(doc).style.fontFamily, initial.style.fontFamily);
  } finally {
    cleanup();
  }
});

test("waits for stored choices before showing a greeting", async () => {
  const { window: { document: doc } } = new JSDOM(`<body>${HOME}</body>`, { url: "http://localhost/" });
  const { promise, resolve } = Promise.withResolvers();
  const cleanup = mountHomeHero({ document: doc, getAppearance: () => promise });
  try {
    doc.body.append(doc.createElement("aside"));
    await tick();
    assert.equal(greeting(doc), null);

    resolve({ displayName: "Alex", randomizeGreeting: false, randomizeFont: false });
    await tick();
    assert.equal(greeting(doc).textContent, formatGreeting(new Date().getHours(), "Alex"));
  } finally {
    cleanup();
  }
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
