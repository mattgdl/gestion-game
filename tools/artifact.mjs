// Prépare la version publiable du jeu (artefact claude.ai) à partir du build :
// la page publiée reçoit sa propre enveloppe <html>/<head>/<body>, on retire donc la nôtre.
// Usage : npm run build && node tools/artifact.mjs
import { readFileSync, writeFileSync } from "node:fs";

const src = new URL("../packages/client/dist/index.html", import.meta.url);
const out = new URL("../packages/client/dist/seigneurie.html", import.meta.url);

let html = readFileSync(src, "utf8");
html = html
  .replace(/<!doctype html>\s*/i, "")
  .replace(/<html[^>]*>\s*/i, "")
  .replace(/<\/html>\s*$/i, "")
  .replace(/<head>\s*/i, "")
  .replace(/<\/head>\s*/i, "")
  .replace(/<body>\s*/i, "")
  .replace(/<\/body>\s*/i, "")
  .replace(/<meta charset="utf-8" \/>\s*/i, "")
  .replace(/<meta name="viewport"[^>]*>\s*/i, "");

if (html.indexOf("<title>") > 8000) throw new Error("Le <title> doit rester dans les 8 premiers Ko.");
writeFileSync(out, html);
console.log(`Écrit : ${out.pathname} (${(html.length / 1024).toFixed(0)} Ko)`);
