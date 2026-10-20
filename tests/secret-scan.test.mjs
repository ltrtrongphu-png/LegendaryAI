import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["scripts/secret-scan.mjs"], { encoding: "utf8" });
assert.equal(result.status, 0, "secret scan failed: " + (result.stderr || result.stdout || "unknown error"));
assert.match(result.stdout, /no high-confidence secrets found/);
console.log("secret-scan: assertions passed");
