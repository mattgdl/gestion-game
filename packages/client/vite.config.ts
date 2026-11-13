import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Le jeu est construit en UN seul fichier HTML (code, styles et données inclus) :
// il s'ouvre partout, sans serveur, et peut être publié tel quel.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
  },
});
