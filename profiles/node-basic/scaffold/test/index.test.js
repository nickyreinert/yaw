import assert from "node:assert/strict";
import test from "node:test";
import { greeting } from "../src/index.js";

test("greets by name", () => {
  assert.equal(greeting("Ada"), "Hello, Ada!");
});
