import { defineConfig } from "vitest/config";
import { compileCssModule } from "./packages/imagegen/scripts/css-modules.js";

export default defineConfig({
  plugins: [
    {
      name: "kepos-imagegen-css-modules-test",
      enforce: "pre",
      async load(id) {
        if (!id.endsWith(".module.dshcss")) return undefined;
        const { classes } = await compileCssModule(id);
        return `export default ${JSON.stringify(classes)};`;
      },
    },
  ],
  test: {
    include: ["packages/**/test/**/*.test.ts"],
    exclude: ["packages/**/test/artifact.test.ts"],
    environment: "node",
    coverage: { enabled: false },
    server: { deps: { inline: ["@deepseek-ai/dsh-client-ui-primitives"] } },
  },
  resolve: {
    alias: {
      "@lamplitisles/imagegen-core": new URL(
        "./packages/imagegen-core/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
