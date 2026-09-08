import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// One ESM bundle. zod and smol-toml are bundled in so the published package has
// zero runtime dependencies and `npx actuals` installs nothing else (SPEC §1).
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  minify: false,
  noExternal: ["zod", "smol-toml"],
  banner: { js: "#!/usr/bin/env node" },
  // --version reads this; the file layout under npx's cache never matters
  define: { __ACTUALS_VERSION__: JSON.stringify(pkg.version) },
});
