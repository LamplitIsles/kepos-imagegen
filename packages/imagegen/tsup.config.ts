import { defineConfig } from "tsup";

const external = [
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-api-remotes",
  "@deepseek-ai/dsh-attachment",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-runtime",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-client-ui-settings-plugins",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-fs",
  "@deepseek-ai/dsh-settings",
  "@deepseek-ai/dsh-tools",
  "@deepseek-ai/schemastery",
  "react",
];

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    platform: "node",
    dts: true,
    clean: true,
    external,
    noExternal: ["@kepos/imagegen-core"],
  },
  {
    entry: { client: "src/client.ts" },
    format: ["cjs"],
    platform: "browser",
    dts: true,
    external,
    noExternal: ["@kepos/imagegen-core"],
    outExtension: () => ({ js: ".js" }),
    banner: {
      js: 'window.__ModuleLoader__.load({ id: "@kepos/dsh-imagegen", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
    },
    footer: { js: "return module.exports; } });" },
  },
]);
