import assert from "node:assert/strict";
import { formatGreeting, greetingFor } from "../greeting.ts";

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test("greeting boundaries", () => {
  assert.equal(greetingFor(0), "Morning");
  assert.equal(greetingFor(11), "Morning");
  assert.equal(greetingFor(12), "Afternoon");
  assert.equal(greetingFor(16), "Afternoon");
  assert.equal(greetingFor(17), "Evening");
  assert.equal(greetingFor(23), "Evening");
  assert.equal(greetingFor(Number.NaN), "Morning");
});

test("no name means no stray comma", () => {
  assert.equal(formatGreeting(11, ""), "Morning");
  assert.equal(formatGreeting(16, "   "), "Afternoon");
});

test("named greeting joins with a comma and space", () => {
  assert.equal(formatGreeting(11, "Alex"), "Morning, Alex");
  assert.equal(formatGreeting(12, " Alex "), "Afternoon, Alex");
  assert.equal(formatGreeting(17, "Alex"), "Evening, Alex");
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
