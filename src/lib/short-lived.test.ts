import { test } from "node:test";
import assert from "node:assert/strict";
import { shortLived } from "./short-lived.ts";

test("shares one read per key inside the window, and reads again after it", async () => {
  let time = 0;
  let reads = 0;
  const get = shortLived(1000, async (key: number) => `${key}:${++reads}`, () => time);

  assert.deepEqual(await Promise.all([get(14), get(14)]), ["14:1", "14:1"]);
  assert.equal(await get(30), "30:2");
  time = 999;
  assert.equal(await get(14), "14:1");
  time = 1000;
  assert.equal(await get(14), "14:3");
});

test("never keeps a rejection", async () => {
  let fail = true;
  const get = shortLived(1000, async () => {
    if (fail) throw new Error("onQ session expired");
    return "ok";
  });

  await assert.rejects(get("k"), /session expired/);
  fail = false;
  assert.equal(await get("k"), "ok");
});
