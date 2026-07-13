// Bump the patch version of the publishable packages in place, editing only the
// "version" line so formatting is preserved. Avoids `npm version`, which cannot
// parse the `workspace:` protocol used by this Bun workspace's dev dependencies.
//
//   node scripts/bump-patch.mjs
import { readFileSync, writeFileSync } from "node:fs";

const files = ["packages/core/package.json", "packages/server/package.json"];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const next = src.replace(
    /("version":\s*")(\d+)\.(\d+)\.(\d+)(")/,
    (_m, pre, maj, min, pat, post) => `${pre}${maj}.${min}.${Number(pat) + 1}${post}`,
  );
  if (next === src) throw new Error(`no "version": "x.y.z" field found to bump in ${f}`);
  writeFileSync(f, next);
  console.log(`${f} -> ${JSON.parse(next).version}`);
}
