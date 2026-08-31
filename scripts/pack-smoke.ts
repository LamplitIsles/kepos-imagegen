import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import Include from "@deepseek-ai/cordis-plugin-include";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import { packedManifest, type PackedManifest } from "./release-shared.js";

const root = resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];
const DSH_ALPHA_VERSION = "0.1.2-alpha.3";
const DSH_CLIENT_INJECT = [
  "@deepseek-ai/dsh-api-remotes",
  "@deepseek-ai/dsh-api-session-controller",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-renderer",
  "@deepseek-ai/dsh-client-ui-session",
  "@deepseek-ai/dsh-client-ui-tool",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-client-ui-settings-plugins",
] as const;
const DSH_EXTERNAL_PEERS = [
  "@deepseek-ai/dsh-api-remotes",
  "@deepseek-ai/dsh-api-session-controller",
  "@deepseek-ai/dsh-attachment",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-renderer",
  "@deepseek-ai/dsh-client-ui-session",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-client-ui-settings-plugins",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-tool",
  "@deepseek-ai/dsh-fs",
  "@deepseek-ai/dsh-settings",
  "@deepseek-ai/dsh-tools",
] as const;

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function pack(packageDirectory: string, destination: string): string {
  const output = run(
    "npm",
    ["pack", "--json", "--pack-destination", destination],
    packageDirectory,
  );
  const filename = packedManifest(
    JSON.parse(output) as PackedManifest,
  )?.filename;
  requireCondition(
    typeof filename === "string",
    "Package manager did not return a tarball name.",
  );
  return join(destination, filename);
}

async function smokeDsh(): Promise<void> {
  const directory = await makeTemporaryDirectory("kepos-imagegen-dsh-pack-");
  const archive = pack(join(root, "packages/dsh-imagegen"), directory);
  const files = run("tar", ["-tzf", archive], directory).trim().split("\n");
  run("tar", ["-xzf", archive, "-C", directory], directory);
  const packageDirectory = join(directory, "package");
  const manifest = JSON.parse(
    await readFile(join(packageDirectory, "package.json"), "utf8"),
  ) as Record<string, any>;

  requireCondition(
    manifest.name === "@lamplitisles/dsh-imagegen",
    "DSH package name is incorrect.",
  );
  requireCondition(
    existsSync(join(packageDirectory, "dist/index.js")),
    "DSH host entry is missing from the packed artifact.",
  );
  requireCondition(
    existsSync(join(packageDirectory, "dist/client.js")),
    "DSH client entry is missing from the packed artifact.",
  );
  requireCondition(
    existsSync(join(packageDirectory, "dist/client.d.cts")),
    "DSH client declaration is missing from the packed artifact.",
  );
  requireCondition(
    manifest.dsh?.bundle?.patch === "./cordis.patch.yml",
    "DSH bundle patch declaration is missing from the packed artifact.",
  );
  requireCondition(
    manifest.dsh?.client?.platform === "web",
    "DSH browser client platform declaration is incorrect.",
  );
  requireCondition(
    (
      await readFile(join(packageDirectory, "cordis.patch.yml"), "utf8")
    ).includes("inject: [attachments, fs, settings, tools]"),
    "DSH host injection contract is missing from the packed artifact.",
  );
  requireCondition(
    JSON.stringify(manifest.dsh?.client?.inject) ===
      JSON.stringify(DSH_CLIENT_INJECT),
    "DSH client injection contract is incorrect.",
  );
  for (const peer of DSH_EXTERNAL_PEERS) {
    requireCondition(
      manifest.peerDependencies?.[peer] === DSH_ALPHA_VERSION,
      `DSH peer ${peer} is not pinned to ${DSH_ALPHA_VERSION}.`,
    );
  }
  requireCondition(
    manifest.peerDependencies?.["@deepseek-ai/cordis"] === "4.0.2" &&
      manifest.peerDependencies?.["@deepseek-ai/schemastery"] === "3.18.2",
    "DSH framework peers are not pinned to the alpha-compatible versions.",
  );
  for (const [dependency, version] of Object.entries(
    manifest.devDependencies ?? {},
  )) {
    if (dependency.startsWith("@deepseek-ai/dsh-")) {
      requireCondition(
        version === DSH_ALPHA_VERSION,
        `DSH development dependency ${dependency} is not pinned to ${DSH_ALPHA_VERSION}.`,
      );
    }
  }
  requireCondition(
    !("@deepseek-ai/dsh-client-runtime" in (manifest.peerDependencies ?? {})),
    "DSH artifact retains the retired client Runtime peer.",
  );
  requireCondition(
    !("@deepseek-ai/dsh-client-runtime" in (manifest.devDependencies ?? {})),
    "DSH artifact retains the retired client Runtime development dependency.",
  );
  requireCondition(
    manifest.dependencies === undefined,
    "DSH artifact has runtime dependencies.",
  );
  requireCondition(
    !("install" in (manifest.scripts ?? {})),
    "DSH artifact has an install hook.",
  );
  requireCondition(
    !JSON.stringify(manifest).includes("workspace:"),
    "DSH artifact leaks a workspace protocol.",
  );
  requireCondition(
    !(await readFile(join(packageDirectory, "dist/index.js"), "utf8")).includes(
      "@lamplitisles/imagegen-core",
    ),
    "DSH artifact retains a runtime core import.",
  );
  requireCondition(
    !files.some(
      (file) =>
        file.includes("node_modules") || /(?:playwright|chromium)/i.test(file),
    ),
    "DSH artifact contains an undeclared browser payload.",
  );

  await smokeDshLoader(directory, packageDirectory);
}

async function smokeDshLoader(
  directory: string,
  packageDirectory: string,
): Promise<void> {
  const profileDirectory = join(directory, "alpha-profile");
  await mkdir(profileDirectory, { recursive: true });
  await symlink(
    join(root, "packages/dsh-imagegen/node_modules"),
    join(directory, "node_modules"),
    "dir",
  );
  const configPath = join(profileDirectory, "cordis.yml");
  await writeFile(
    configPath,
    [
      "- name: '@test/imagegen-services'",
      "- name: '@lamplitisles/dsh-imagegen'",
      "",
    ].join("\n"),
  );

  const registered: {
    namespace?: string;
    schema?: unknown;
    tool?: { name?: string };
  } = {};
  const services = {
    attachments: {
      async validateImage() {},
      async saveImage() {
        return {
          attachmentId: "smoke",
          mediaType: "image/png",
          bytes: 1,
          width: 1,
          height: 1,
        };
      },
    },
    fs: {},
    settings: {
      register(namespace: string, schema: unknown) {
        registered.namespace = namespace;
        registered.schema = schema;
        return { get: () => ({ bridgeUrl: "https://bridge.invalid" }) };
      },
    },
    tools: {
      register(tool: { name?: string }) {
        registered.tool = tool;
      },
    },
  };
  const modules = new Map<string, unknown>([
    [
      "@test/imagegen-services",
      {
        apply(ctx: Context) {
          for (const [name, service] of Object.entries(services)) {
            ctx.provide(name, service);
          }
        },
      },
    ],
    [
      "@lamplitisles/dsh-imagegen",
      await import(pathToFileURL(join(packageDirectory, "dist/index.js")).href),
    ],
  ]);

  const context = new Context();
  context.baseUrl = `${pathToFileURL(profileDirectory).href}/`;
  try {
    await context.plugin(Loader);
    context.loader.builtins.include = Include;
    context.loader.internal = {
      version: "v2",
      async import(specifier: string) {
        if (!modules.has(specifier)) {
          throw new Error(`unexpected Loader import: ${specifier}`);
        }
        return modules.get(specifier);
      },
    } as unknown as NonNullable<typeof context.loader.internal>;
    await context.loader.create({
      name: "cordis:include",
      config: { path: pathToFileURL(configPath).href },
    });
    await context.loader.await();
    requireCondition(
      registered.namespace === "lamplitisles-kepos-imagegen",
      "Alpha Loader did not register the ImageGen settings namespace.",
    );
    requireCondition(
      registered.tool?.name === "kepos_image_generate",
      "Alpha Loader did not register the ImageGen tool.",
    );
  } finally {
    await context.fiber.dispose();
  }

  await smokeDshClient(packageDirectory);
}

async function smokeDshClient(packageDirectory: string): Promise<void> {
  const clientSource = await readFile(
    join(packageDirectory, "dist/client.js"),
    "utf8",
  );
  requireCondition(
    !clientSource.includes("dsh-client-runtime"),
    "Packed DSH client still references the retired client Runtime.",
  );

  let loaded:
    | {
        id?: string;
        factory?: (require: (specifier: string) => unknown) => unknown;
      }
    | undefined;
  type LoaderEntry = NonNullable<typeof loaded>;
  type LoaderWindow = {
    __ModuleLoader__: { load(entry: LoaderEntry): void };
  };
  const globalWithWindow = globalThis as unknown as { window?: LoaderWindow };
  const previousWindow = globalWithWindow.window;
  globalWithWindow.window = {
    __ModuleLoader__: {
      load(entry: LoaderEntry) {
        loaded = entry;
      },
    },
  };
  try {
    await import(
      `${pathToFileURL(join(packageDirectory, "dist/client.js")).href}?alpha-smoke`
    );
  } finally {
    if (previousWindow === undefined) {
      delete globalWithWindow.window;
    } else {
      globalWithWindow.window = previousWindow;
    }
  }
  requireCondition(
    loaded?.id === "@lamplitisles/dsh-imagegen",
    "Packed DSH client did not register with the loader.",
  );
  requireCondition(
    typeof loaded?.factory === "function",
    "Packed DSH client loader entry has no factory.",
  );

  const client = loaded?.factory?.((specifier) => {
    if (specifier === "@deepseek-ai/dsh-client-ui-primitives") {
      return { IconChevronDownOutline14: () => null };
    }
    if (specifier === "react") {
      return {
        createElement: () => null,
        useEffect: () => undefined,
        useId: () => "smoke",
        useState: (value: unknown) => [value, () => undefined],
      };
    }
    if (specifier === "react-dom") return { createPortal: () => null };
    throw new Error(`unexpected packed client dependency: ${specifier}`);
  }) as {
    apply?: (ctx: unknown) => void;
    inject?: readonly string[];
  };
  requireCondition(
    typeof client?.apply === "function",
    "Packed DSH client did not expose apply().",
  );
  requireCondition(
    JSON.stringify(client?.inject) ===
      JSON.stringify(["sessions", "settingsScope", "slots"]),
    "Packed DSH client inject contract is incorrect.",
  );

  const registrations: Array<{ name: string; key: string }> = [];
  let boundSettings:
    { namespace?: string; decode?: (value: unknown) => unknown } | undefined;
  const scope = {
    getSnapshot: () => ({
      status: "ready" as const,
      value: { bridgeUrl: "https://bridge.invalid" },
      base: {},
      user: {},
      revision: 1,
      writable: true,
      mode: "host" as const,
    }),
    subscribe: () => () => undefined,
    set: async () => undefined,
  };
  client?.apply?.({
    effect() {},
    settingsScope: {
      bind(spec: { namespace?: string; decode?: (value: unknown) => unknown }) {
        boundSettings = spec;
        return scope;
      },
    },
    sessions: { binding: () => undefined },
    slots: {
      inject(_name: string, callback: () => unknown) {
        callback();
      },
      register(spec: { name: string; key: string }) {
        registrations.push(spec);
        return () => undefined;
      },
    },
  });
  requireCondition(
    boundSettings?.namespace === "lamplitisles-kepos-imagegen" &&
      typeof boundSettings.decode === "function",
    "Packed DSH client did not bind its alpha settings scope contract.",
  );
  requireCondition(
    registrations.some(
      ({ name, key }) =>
        name === "settings.plugin.item" &&
        key === "lamplitisles-kepos-imagegen",
    ),
    "Packed DSH client did not register its native settings card.",
  );
  requireCondition(
    registrations.some(
      ({ name, key }) =>
        name === "tool.call.toolview" && key === "kepos_image_generate",
    ),
    "Packed DSH client did not register its keyed image tool view.",
  );
}

async function writeFakePackage(
  directory: string,
  name: string,
  version: string,
  source = "export {};\n",
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ name, version, type: "module", exports: "./index.js" })}\n`,
  );
  await writeFile(join(directory, "index.js"), source);
}

async function smokePi(): Promise<void> {
  const directory = await makeTemporaryDirectory("kepos-imagegen-pi-pack-");
  const archive = pack(join(root, "packages/pi-imagegen"), directory);
  const fakes = join(directory, "fakes");
  await writeFakePackage(
    join(fakes, "pi-coding-agent"),
    "@earendil-works/pi-coding-agent",
    "0.84.1",
    'export const getAgentDir = () => "/fake-pi-agent";\n',
  );
  await writeFakePackage(
    join(fakes, "pi-ai"),
    "@earendil-works/pi-ai",
    "0.84.1",
  );
  await writeFakePackage(
    join(fakes, "typebox"),
    "typebox",
    "1.3.19",
    "export const Type = { String: (value = {}) => ({ type: 'string', ...value }), Array: (item, value = {}) => ({ type: 'array', items: item, ...value }), Optional: (value) => ({ ...value, optional: true }), Object: (value, options = {}) => ({ type: 'object', properties: value, ...options }) };\n",
  );
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({
      name: "packed-pi-smoke",
      private: true,
      type: "module",
      dependencies: {
        "@lamplitisles/pi-imagegen": `file:${archive}`,
        "@earendil-works/pi-coding-agent": "file:./fakes/pi-coding-agent",
        "@earendil-works/pi-ai": "file:./fakes/pi-ai",
        typebox: "file:./fakes/typebox",
      },
    })}\n`,
  );
  run(
    "pnpm",
    ["install", "--ignore-scripts", "--no-frozen-lockfile"],
    directory,
  );

  const packageDirectory = join(
    directory,
    "node_modules/@lamplitisles/pi-imagegen",
  );
  const manifest = JSON.parse(
    await readFile(join(packageDirectory, "package.json"), "utf8"),
  ) as Record<string, any>;
  requireCondition(
    JSON.stringify(manifest.pi?.extensions) ===
      JSON.stringify(["./dist/index.js"]),
    "Pi extension manifest is invalid.",
  );
  requireCondition(
    Array.isArray(manifest.keywords) &&
      manifest.keywords.includes("pi-package"),
    "Pi package keyword is missing.",
  );
  requireCondition(
    manifest.dependencies === undefined,
    "Pi artifact has runtime dependencies.",
  );
  requireCondition(
    !("install" in (manifest.scripts ?? {})),
    "Pi artifact has an install hook.",
  );
  requireCondition(
    !JSON.stringify(manifest).includes("workspace:"),
    "Pi artifact leaks a workspace protocol.",
  );
  requireCondition(
    !(await readFile(join(packageDirectory, "dist/index.js"), "utf8")).includes(
      "@lamplitisles/imagegen-core",
    ),
    "Pi artifact retains a runtime core import.",
  );

  const extension = await import(
    pathToFileURL(join(packageDirectory, "dist/index.js")).href
  );
  const tools: unknown[] = [];
  const commands: unknown[] = [];
  extension.default({
    registerTool(tool: unknown) {
      tools.push(tool);
    },
    registerCommand(_name: string, command: unknown) {
      commands.push(command);
    },
  });
  requireCondition(
    tools.length === 1 &&
      (tools[0] as { name?: string }).name === "kepos_image_generate",
    "Pi artifact did not register exactly one image tool.",
  );
  requireCondition(
    commands.length === 1,
    "Pi artifact did not register its settings command.",
  );
}

async function main(): Promise<void> {
  try {
    await smokeDsh();
    await smokePi();
    console.log("Packed-artifact smoke checks passed.");
  } finally {
    await Promise.all(
      temporaryDirectories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
