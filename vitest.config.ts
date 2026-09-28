import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/** 工作区内的包直接跑源码，测试不必先 build。新增包时在这里补一个名字。 */
const local = ["arc", "spinal"];

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(local.map((name) => [`@sekizui/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))])),
  },
  test: {
    exclude: ["**/node_modules/**", "**/.git/**"],
  },
});
