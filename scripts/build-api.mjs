import { build } from "esbuild";
await build({
  entryPoints: ["server/handler.ts"],
  outfile: "server/runtime.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  legalComments: "none",
});
console.log("Bundled Vercel API runtime: server/runtime.mjs");
