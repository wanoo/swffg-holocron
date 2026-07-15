import { compilePack } from "@foundryvtt/foundryvtt-cli";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const PACKS = [
  ["packs/_src_regles", "packs/regles"],
  ["packs/_src_macros", "packs/macros"],
  ["packs/_src_structure", "packs/structure"],
  ["packs/_src_sample", "packs/sample"],
  ["packs/_src_evenements", "packs/evenements"],
  ["packs/_src_tables", "packs/tables"],
];

for (const [src, dest] of PACKS) {
  const s = path.join(root, src);
  const d = path.join(root, dest);
  console.log(`\n=== Compiling ${src} -> ${dest} ===`);
  await compilePack(s, d, { log: true });
}
console.log("\nDone.");
