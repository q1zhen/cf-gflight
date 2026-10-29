import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { vm: fileURLToPath(new URL("./src/bootstrap.ts", import.meta.url)) } },
  test: { server: { deps: { inline: ["google-flights-scraper"] } } },
});
