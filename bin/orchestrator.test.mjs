import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classify,
  parseCountPair,
  parseStatus,
  parseWorktrees,
  resourceAdvice,
} from "./orchestrator.mjs";

test("parseWorktrees reads paths, branches, detached heads, locks and prunable entries", () => {
  const porcelain = [
    "worktree C:/repo",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/develop",
    "",
    "worktree C:/trees/task-a",
    "HEAD 2222222222222222222222222222222222222222",
    "detached",
    "locked agent is using it",
    "",
    "worktree C:/trees/gone",
    "HEAD 3333333333333333333333333333333333333333",
    "prunable gitdir file points to non-existent location",
    "",
  ].join("\n");

  const result = parseWorktrees(porcelain);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], {
    path: "C:/repo",
    head: "1111111111111111111111111111111111111111",
    branch: "develop",
    detached: false,
    bare: false,
    locked: null,
    prunable: null,
  });
  assert.equal(result[1].detached, true);
  assert.equal(result[1].locked, "agent is using it");
  assert.equal(result[2].prunable, "gitdir file points to non-existent location");
});

test("parseStatus counts staged, unstaged and untracked entries and ignores ignored files", () => {
  const text = ["M  a.txt", " M b.txt", "A  c.txt", "?? d.txt", "!! build/", ""].join("\n");
  assert.deepEqual(parseStatus(text), { staged: 2, unstaged: 1, untracked: 1, dirty: true });
  assert.deepEqual(parseStatus(""), { staged: 0, unstaged: 0, untracked: 0, dirty: false });
  assert.deepEqual(parseStatus("!! only-ignored"), {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    dirty: false,
  });
});

test("parseCountPair reads the two numbers and degrades to zeros", () => {
  assert.deepEqual(parseCountPair("3\t5"), { left: 3, right: 5 });
  assert.deepEqual(parseCountPair("0 0"), { left: 0, right: 0 });
  assert.deepEqual(parseCountPair("garbage"), { left: 0, right: 0 });
  assert.deepEqual(parseCountPair(null), { left: 0, right: 0 });
});

test("classify puts preservation risks before everything else", () => {
  assert.equal(classify({ prunable: "gone" }), "prunable");
  assert.equal(classify({ bare: true }), "bare");
  assert.equal(classify({ locked: "someone" }), "protected");
  assert.equal(classify({ dirty: true, branch: "x", headOnRemote: true }), "uncommitted");
  assert.equal(classify({ detached: true, branch: null }), "detached");
  assert.equal(classify({ branch: null }), "unknown");
  assert.equal(classify({ branch: "x", mergedIntoBase: true, headOnRemote: true }), "integrated");
  assert.equal(classify({ branch: "x", mergedIntoBase: false, headOnRemote: false }), "local-only");
  assert.equal(classify({ branch: "x", headOnRemote: true, aheadOfRemote: 2 }), "unpushed");
  assert.equal(classify({ branch: "x", headOnRemote: true, aheadOfRemote: 0 }), "ready");
});

test("resourceAdvice is green with headroom, amber when tight, red under pressure", () => {
  const green = resourceAdvice({
    freeMemGb: 12,
    totalMemGb: 24,
    cpuCount: 8,
    loadPct: 20,
    freeDiskGb: 100,
  });
  assert.equal(green.level, "green");
  assert.ok(green.heavySlots >= 1);
  assert.ok(green.moderateSlots >= green.heavySlots);
  assert.match(green.advice, /headroom/i);

  const amber = resourceAdvice({ freeMemGb: 4, totalMemGb: 24, cpuCount: 8, loadPct: 30, freeDiskGb: 100 });
  assert.equal(amber.level, "amber");
  assert.equal(amber.heavySlots, 1);
  assert.equal(amber.reasons.length, 1);

  const redMemory = resourceAdvice({
    freeMemGb: 1,
    totalMemGb: 24,
    cpuCount: 8,
    loadPct: 10,
    freeDiskGb: 100,
  });
  assert.equal(redMemory.level, "red");
  assert.equal(redMemory.heavySlots, 0);
  assert.match(redMemory.advice, /light work only/i);

  const redLoad = resourceAdvice({ freeMemGb: 12, cpuCount: 8, loadPct: 95, freeDiskGb: 100 });
  assert.equal(redLoad.level, "red");
  assert.match(redLoad.reasons.join(" "), /CPU load/);
});

test("resourceAdvice treats unmeasurable values as unknown, not as a problem", () => {
  const unknown = resourceAdvice({
    freeMemGb: null,
    totalMemGb: null,
    cpuCount: 4,
    loadPct: null,
    freeDiskGb: null,
  });
  assert.equal(unknown.level, "green");
  assert.deepEqual(unknown.reasons, []);
  assert.equal(unknown.measured.loadPct, null);
});

test("resourceAdvice rounds the numbers it reports", () => {
  const advice = resourceAdvice({ freeMemGb: 3.14159, cpuCount: 8, loadPct: 61.7, freeDiskGb: 42.04 });
  assert.equal(advice.measured.freeMemGb, 3.1);
  assert.equal(advice.measured.loadPct, 62);
  assert.equal(advice.measured.freeDiskGb, 42);
});
