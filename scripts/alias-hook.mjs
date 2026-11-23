import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const jsonModules = path.join(os.tmpdir(), "content-engine-json-modules");

function aliasFile(specifier) {
  const base = path.join(root, specifier.slice(2));
  if (path.extname(base)) return base;
  const candidates = [`${base}.ts`, `${base}.tsx`, `${base}.json`, path.join(base, "index.ts")];
  return candidates.find((file) => existsSync(file)) ?? base;
}

// A load hook makes Node give CommonJS a require() without require.cache, and webpack crashes on that.
// JSON is rewritten to a real module file so the resolve hook can stay the only hook.
function jsonModuleUrl(file) {
  const source = readFileSync(file);
  const name = createHash("sha256").update(file).update(source).digest("hex") + ".mjs";
  mkdirSync(jsonModules, { recursive: true });
  const dest = path.join(jsonModules, name);
  if (!existsSync(dest)) writeFileSync(dest, `export default ${source};\n`);
  return pathToFileURL(dest).href;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const file = aliasFile(specifier);
    if (file.endsWith(".json")) return { url: jsonModuleUrl(file), shortCircuit: true };
    return nextResolve(pathToFileURL(file).href, context);
  },
});
