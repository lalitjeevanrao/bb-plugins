import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { applyHero, findColumn, HERO_ID } from "../hero.mjs";

const PAGE = `<body>
  <div class="flex"><div class="relative"><div class="@container/page">
    <div class="mx-auto max-w-[760px] px-4" id="column">
      <form class="group/promptbox" data-testid="root-compose-prompt"></form>
    </div>
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
  assert.match(doc.getElementById("bb-hero-style").textContent, /prefers-reduced-motion/);
});

test("finds the compact homepage column on narrow viewports", () => {
  const doc = page(`<body>
    <div data-testid="root-compose-compact-home">
      <div class="absolute inset-x-0 bottom-0 z-10" data-testid="root-compose-compact-composer">
        <div class="mx-auto w-full max-w-[760px] px-4" id="compact-column">
          <form class="group/promptbox" data-testid="root-compose-compact-input"></form>
        </div>
      </div>
    </div>
  </body>`);
  assert.equal(findColumn(doc)?.id, "compact-column");
  const dispose = applyHero(doc, { hours: 9, reducedMotion: true });
  assert.equal(doc.querySelectorAll(`#${HERO_ID}`).length, 1);
  assert.equal(doc.getElementById("compact-column").firstElementChild.id, HERO_ID);
  dispose();
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
  assert.equal(doc.querySelector(".bb-hero-sizer").textContent, "Morning, Alex");
  assert.equal(doc.querySelector(".bb-hero-typed").textContent, "Morning, Alex");
});

test("typing reserves the final width and writes only on character change", async () => {
  const doc = page();
  const view = doc.defaultView;
  const queue = [];
  let now = 0;
  const realNow = Date.now;
  view.requestAnimationFrame = fn => { queue.push(fn); return queue.length; };
  view.cancelAnimationFrame = () => {};
  Date.now = () => 1000 + now;
  try {
    const dispose = applyHero(doc, { hours: 9, displayName: "Alex" });
    const greeting = doc.querySelector(".bb-hero-greeting");
    const sizer = doc.querySelector(".bb-hero-sizer");
    const typed = doc.querySelector(".bb-hero-typed");
    // The in-flow sizer carries the complete string; the typed copy overlays it.
    assert.equal(sizer.textContent, "Morning, Alex");
    assert.equal(sizer.getAttribute("aria-hidden"), "true");
    assert.equal(greeting.firstElementChild, sizer);
    assert.equal(greeting.lastElementChild, typed);
    assert.equal(typed.textContent, "");
    assert.equal(view.getComputedStyle(typed).position, "absolute");
    assert.equal(view.getComputedStyle(sizer).visibility, "hidden");

    const writes = [];
    const observer = new view.MutationObserver(records => writes.push(...records));
    observer.observe(typed, { subtree: true, childList: true, characterData: true });
    const pump = at => {
      now = at;
      for (const fn of queue.splice(0)) fn(1000 + now);
    };

    pump(150);
    assert.equal(typed.textContent, "", "the entrance plays before typing starts");
    pump(300);
    const midway = typed.textContent;
    assert.ok(midway.length > 0 && midway.length < "Morning, Alex".length);
    await new Promise(resolve => setTimeout(resolve, 0));
    const writesAfterGrowth = writes.length;
    assert.ok(writesAfterGrowth > 0);

    pump(300);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(writes.length, writesAfterGrowth, "unchanged length must not rewrite the DOM");

    pump(2200);
    assert.equal(typed.textContent, "Morning, Alex");
    assert.equal(queue.length, 0, "typing stops after the final frame");
    assert.equal(sizer.textContent, "Morning, Alex", "the reserved width never changes");

    dispose();
    assert.equal(doc.getElementById(HERO_ID), null);
  } finally {
    Date.now = realNow;
  }
});

test("skips a CSS-hidden home tree in favour of the visible one", () => {
  const doc = page(`<body>
    <div data-testid="root-compose-compact-home" style="display:none">
      <div class="mx-auto w-full max-w-[760px]" id="hidden-column">
        <form class="group/promptbox"></form>
      </div>
    </div>
    <div data-testid="root-compose-compact-home">
      <div class="mx-auto w-full max-w-[760px]" id="visible-column">
        <form class="group/promptbox"></form>
      </div>
    </div>
  </body>`);
  assert.equal(findColumn(doc)?.id, "visible-column");
  const dispose = applyHero(doc, { hours: 9, reducedMotion: true });
  assert.equal(doc.querySelectorAll(`#${HERO_ID}`).length, 1);
  assert.equal(doc.getElementById("visible-column").firstElementChild.id, HERO_ID);
  assert.equal(doc.getElementById("hidden-column").firstElementChild.tagName, "FORM");
  dispose();
});

test("ignores a generic mx-auto column with no home composer target", () => {
  const doc = page(`<body><div class="flex"><div class="relative"><div class="@container/page">
    <div class="mx-auto max-w-[760px]" id="other-column"></div>
  </div></div></div></body>`);
  assert.equal(findColumn(doc), null);
  const dispose = applyHero(doc, { hours: 9 });
  assert.equal(doc.querySelectorAll(`#${HERO_ID}`).length, 0);
  assert.equal(doc.getElementById("bb-hero-style"), null);
  dispose();
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
