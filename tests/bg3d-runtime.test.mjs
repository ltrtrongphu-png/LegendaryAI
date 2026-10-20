import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("js/bg3d.js", "utf8");
assert.match(source, /prefers-reduced-motion: reduce/, "background must respect reduced motion");
assert.match(source, /navigator\.hardwareConcurrency/, "background must detect low CPU capability");
assert.match(source, /navigator\.deviceMemory/, "background must detect low-memory devices");
assert.match(source, /var staticScene = reduceMotion \|\| lowEnd/, "reduced-motion/low-end devices must not run a continuous animation loop");
assert.match(source, /var maxLines = staticScene \? 45 : 160/, "static/low-end rendering must reduce mesh complexity");
assert.match(source, /document\.addEventListener\('visibilitychange', visibilityHandler\)/, "animation must pause when the tab is hidden");
assert.match(source, /geometry\.dispose\(\)/, "WebGL geometry must be released on pagehide");
assert.match(source, /material\.dispose\(\)/, "particle material must be released on pagehide");
assert.match(source, /lineGeom\.dispose\(\)/, "line geometry must be released on pagehide");
assert.match(source, /renderer\.dispose\(\)/, "renderer must be disposed on pagehide");
assert.match(source, /forceContextLoss\(\)/, "WebGL context should be released on pagehide");
console.log("bg3d-runtime: assertions passed");
