import test from "node:test";
import assert from "node:assert/strict";
import { AudioDirector } from "../src/av/audio.mjs";
test("a hidden or read-only page cannot resume audio by clicking an export control", () => {
  const a = new AudioDirector();
  let resumes = 0;
  a.unlocked = true;
  a.ctx = {
    state: "suspended",
    resume() {
      resumes++;
      return Promise.resolve();
    },
  };
  a.hidden = true;
  a.unlock();
  assert.equal(resumes, 0);
  a.hidden = false;
  a.unlock();
  assert.equal(resumes, 1);
});
