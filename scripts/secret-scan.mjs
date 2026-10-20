#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const historyMode = process.argv.includes("--history");
const patterns = [
  ["private key PEM", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub access token", /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["OpenAI API secret", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
  ["MoMo secret literal", /MOMO_SECRET_KEY\s*[:=]\s*["']([A-Za-z0-9+/=_-]{16,})["']/i],
  ["service-role JWT assignment", /(?:SUPABASE_SERVICE_ROLE_KEY|service[_ -]?role[_ -]?key)\s*[:=]\s*["']?(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/i],
  ["inference or cleanup secret assignment", /(?:LEGENDARY_LOCAL_AI_TOKEN|HF_ACCESS_TOKEN|RETENTION_CLEANUP_SECRET)\s*[:=]\s*["']([A-Za-z0-9+/=_-]{24,})["']/i]
];

const findings = [];
function scanText(text, file, lineOffset = 0) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [label, regex] of patterns) {
      if (regex.test(line)) {
        findings.push({ label, file, line: i + 1 + lineOffset });
        break;
      }
    }
  });
}
function runGit(args, maxBuffer = 64 * 1024 * 1024) {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer });
  if (r.error || r.status !== 0) {
    console.error("secret-scan: git command failed; ensure Git and repository history are available");
    process.exit(2);
  }
  return r.stdout || "";
}

const tracked = runGit(["ls-files", "-co", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
for (const file of tracked) {
  if (file.startsWith(".git/") || file.includes("/node_modules/") || extname(file) === ".png" || extname(file) === ".jpg" || extname(file) === ".webp" || extname(file) === ".ico") continue;
  try {
    const raw = readFileSync(file);
    if (raw.length <= 2_000_000) scanText(raw.toString("utf8"), file);
  } catch {
    // Ignore a file that disappeared during a concurrent workspace operation.
  }
}

if (historyMode) {
  const history = runGit(["log", "--all", "--no-ext-diff", "-p", "--format=", "--", "."], 128 * 1024 * 1024);
  let currentFile = "git-history";
  let changedLine = 0;
  for (const line of history.split(/\r?\n/)) {
    const header = line.match(/^diff --git a\/(.+) b\//);
    if (header) { currentFile = "history:" + header[1]; changedLine = 0; continue; }
    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/);
      changedLine = match ? Number(match[1]) - 1 : 0;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      changedLine += 1;
      for (const [label, regex] of patterns) {
        if (regex.test(line.slice(1))) { findings.push({ label, file: currentFile, line: changedLine }); break; }
      }
    } else if (!line.startsWith("-") && !line.startsWith("\\")) {
      changedLine += 1;
    }
  }
}

if (findings.length) {
  for (const f of findings) console.error("secret-scan: potential " + f.label + " at " + f.file + ":" + f.line + " (value redacted)");
  process.exit(1);
}
console.log("secret-scan: no high-confidence secrets found" + (historyMode ? " in working tree and fetched Git history" : " in working tree"));
