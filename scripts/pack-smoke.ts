import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

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
  const filename = (JSON.parse(output) as Array<{ filename: string }>)[0]
    ?.filename;
  requireCondition(
    typeof filename === "string",
    "Package manager did not return a tarball name.",
  );
  return join(destination, filename);
}

async function smokeDsh(): Promise<void> {
  const directory = await makeTemporaryDirectory("kepos-imagegen-dsh-pack-");
  const archive = pack(join(root, "packages/imagegen"), directory);
  const files = run("tar", ["-tzf", archive], directory).trim().split("\n");
  run("tar", ["-xzf", archive, "-C", directory], directory);
  const packageDirectory = join(directory, "package");
  const manifest = JSON.parse(
    await readFile(join(packageDirectory, "package.json"), "utf8"),
  ) as Record<string, any>;

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
    (
      await readFile(join(packageDirectory, "cordis.patch.yml"), "utf8")
    ).includes("inject: [attachments, fs, settings, tools]"),
    "DSH host injection contract is missing from the packed artifact.",
  );
  requireCondition(
    manifest.peerDependencies?.["@deepseek-ai/dsh-tools"] === "0.1.0-rc.8",
    "DSH rc.8 peer is incorrect.",
  );
  requireCondition(
    manifest.peerDependencies?.["@deepseek-ai/dsh-attachment"] === "0.1.0-rc.8",
    "DSH attachment peer is incorrect.",
  );
  requireCondition(
    manifest.peerDependencies?.["@deepseek-ai/dsh-client-runtime"] ===
      "0.1.0-rc.8",
    "DSH client peer is incorrect.",
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
      "@kepos/imagegen-core",
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
        "@kepos/pi-imagegen": `file:${archive}`,
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

  const packageDirectory = join(directory, "node_modules/@kepos/pi-imagegen");
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
      "@kepos/imagegen-core",
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
