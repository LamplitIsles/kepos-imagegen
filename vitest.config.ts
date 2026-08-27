import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts"],
    exclude: ["packages/**/test/artifact.test.ts"],
    environment: "node",
    coverage: { enabled: false },
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
