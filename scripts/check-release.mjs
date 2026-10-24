import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { validateConfig, DEFAULTS } from "../config.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
assert.equal(pkg.name, "qq-life");
assert.equal(pkg.private, undefined);
assert.equal(pkg.license, "MIT");
for (const f of [
  "index.js",
  "client.js",
  "cordis.patch.yml",
  "LICENSE",
  "NOTICE",
  "README.md",
  "panel.html",
  "scripts/install.mjs",
])
  assert.ok(fs.statSync(path.join(root, f)).isFile(), f);
const denied =
  /sk-[A-Za-z0-9_-]{16,}|-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----/;
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    if (["node_modules", "dist", "coverage"].includes(e.name)) continue;
    const file = path.join(dir, e.name);
    if (e.isDirectory()) walk(file);
    else if (e.isFile() && /\.(?:js|mjs|json|md|html|yml)$/.test(e.name)) {
      assert.ok(
        !denied.test(fs.readFileSync(file, "utf8")),
        "Private deployment data in " + file,
      );
      files.push(path.relative(root, file));
    }
  }
}
walk(root);
for (const f of fs.readdirSync(root).filter((f) => f.endsWith(".js"))) {
  const text = fs.readFileSync(path.join(root, f), "utf8");
  assert.ok(
    !/from\s+["']\.\.\//.test(text),
    "External relative import in " + f,
  );
  for (const match of text.matchAll(
    /(?:from\s+|import\s*\()["'](\.\/[\w./-]+)["']/g,
  ))
    assert.ok(
      fs.existsSync(path.resolve(root, match[1])),
      "Missing local module " + match[1],
    );
}
assert.equal(DEFAULTS.proactiveEnabled, false);
assert.equal(DEFAULTS.proactiveGroups, "");
assert.equal(DEFAULTS.semanticMemoryEnabled, false);
assert.equal(DEFAULTS.leisureIntegration, false);
validateConfig(DEFAULTS);
console.log(
  JSON.stringify({
    releaseCheck: "passed",
    scannedFiles: files.length,
    dependencyFreeCore: true,
    noPrivateDeploymentData: true,
    defaultProactive: false,
    defaultExtraModelCalls: false,
  }),
);
