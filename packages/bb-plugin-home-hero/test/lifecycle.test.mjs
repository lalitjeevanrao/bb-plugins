import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { applyHero, findColumn, HERO_ID } from "../hero.mjs";

const PAGE = `<body>
  <div class="flex"><div class="relative"><div class="@container/page">
    <div class="mx-auto" id="column"></div>
  </div></div></div>
</body>`;

function page(html = PAGE) {
  return new JSDOM(html).window.document;
}

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBAH/3a4d1QAAAABJRU5ErkJggg==";

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test("renders one hero above the composer column", () => {
  const doc = page();
  applyHero(doc, { hours: 9 });
  const heroes = doc.querySelectorAll(`#${HERO_ID}`);
  const column = doc.getElementById("column");
  assert.equal(heroes.length, 1);
  assert.equal(heroes[0].parentElement, column);
  assert.equal(column.firstElementChild, heroes[0]);
  assert.ok(column.hasAttribute("data-bb-hero-column"));
  assert.equal(doc.querySelector(".bb-hero-greeting").textContent, "Morning");
  assert.match(doc.getElementById("bb-hero-style").textContent, /plugin-homepage/);
});

test("greets with the configured name", () => {
  const doc = page();
  applyHero(doc, { hours: 14, displayName: "Alex" });
  assert.equal(doc.querySelector(".bb-hero-greeting").textContent, "Afternoon, Alex");
  assert.equal(doc.querySelector(".bb-hero-name").textContent, "Alex");
  assert.equal(doc.querySelector(".bb-hero-hello").textContent, "Afternoon, ");
});

test("treats the name as text, never markup", () => {
  const doc = page();
  applyHero(doc, { hours: 9, displayName: "<b>Alex</b>" });
  const name = doc.querySelector(".bb-hero-name");
  assert.equal(name.textContent, "<b>Alex</b>");
  assert.equal(name.querySelector("b"), null);
});

test("shows the uploaded icon only when one exists", () => {
  const withIcon = page();
  applyHero(withIcon, { hours: 9, iconDataUrl: PNG });
  assert.equal(withIcon.querySelector(".bb-hero-icon")?.getAttribute("src"), PNG);

  const withoutIcon = page();
  applyHero(withoutIcon, { hours: 9, iconDataUrl: null });
  assert.equal(withoutIcon.querySelector(".bb-hero-icon"), null);
});

test("re-applying keeps a single hero", () => {
  const doc = page();
  applyHero(doc, { hours: 9, displayName: "Alex" });
  applyHero(doc, { hours: 18, displayName: "Sam" });
  assert.equal(doc.querySelectorAll(`#${HERO_ID}`).length, 1);
  assert.equal(doc.querySelector(".bb-hero-greeting").textContent, "Evening, Sam");
});

test("the hero survives until the last mounted owner unmounts", () => {
  const doc = page();
  const first = applyHero(doc, { hours: 9, displayName: "Alex" });
  const second = applyHero(doc, { hours: 9, displayName: "Sam" });
  assert.equal(doc.querySelectorAll(`#${HERO_ID}`).length, 1);
  assert.equal(doc.querySelector(".bb-hero-greeting").textContent, "Morning, Sam");
  second();
  assert.equal(doc.querySelectorAll(`#${HERO_ID}`).length, 1);
  assert.equal(doc.querySelector(".bb-hero-greeting").textContent, "Morning, Sam");
  first();
  assert.equal(doc.getElementById(HERO_ID), null);
  assert.equal(doc.querySelector("[data-bb-hero-column]"), null);
});

test("disposal removes the hero, styles and column marker", () => {
  const doc = page();
  const dispose = applyHero(doc, { hours: 9 });
  dispose();
  assert.equal(doc.getElementById(HERO_ID), null);
  assert.equal(doc.querySelector("[data-bb-hero-column]"), null);
  assert.equal(doc.getElementById("bb-hero-style"), null);
});

test("reduced motion shows the full greeting immediately", () => {
  const doc = page();
  applyHero(doc, { hours: 9, displayName: "Alex", reducedMotion: true });
  assert.equal(doc.querySelector(".bb-hero-greeting").textContent, "Morning, Alex");
});

test("a page without a composer column is harmless", () => {
  const doc = page("<body><div>nothing</div></body>");
  const dispose = applyHero(doc, { hours: 9 });
  assert.equal(findColumn(doc), null);
  assert.equal(doc.getElementById(HERO_ID), null);
  assert.doesNotThrow(dispose);
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
