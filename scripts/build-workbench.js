import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const entryPoint = fileURLToPath(new URL("../src/ui/main.js", import.meta.url));
const outputFile = fileURLToPath(new URL("../build/workbench.js", import.meta.url));

await build({
  entryPoints: [entryPoint],
  outfile: outputFile,
  bundle: true,
  format: "esm",
  platform: "browser",
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
  assetNames: "fonts/[name]-[hash]",
  target: "es2022",
  sourcemap: true,
  legalComments: "eof",
  logLevel: "info"
});
