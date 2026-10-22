import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

function aliasFile(specifier) {
  const base = path.join(root, specifier.slice(2));
  if (path.extname(base)) return base;
  const candidates = [`${base}.ts`, `${base}.tsx`, `${base}.json`, path.join(base, "index.ts")];
  return candidates.find((file) => existsSync(file)) ?? base;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(pathToFileURL(aliasFile(specifier)).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      return {
        format: "json",
        source: readFileSync(fileURLToPath(url), "utf8"),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
