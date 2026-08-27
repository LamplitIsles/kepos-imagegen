import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PUBLIC_PACKAGES = [
  {
    directory: "dsh-imagegen",
    name: "@lamplitisles/dsh-imagegen",
    requiredFiles: [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/client.js",
      "cordis.patch.yml",
    ],
  },
  {
    directory: "pi-imagegen",
    name: "@lamplitisles/pi-imagegen",
    requiredFiles: ["dist/index.js", "dist/index.d.ts"],
  },
] as const;

const tagPattern =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function versionFromTag(tag: string): string {
  const match = tagPattern.exec(tag);
  if (!match) {
    throw new Error(
      "Release tags must use v<semver>, for example v0.1.0 or v0.1.0-beta.1.",
    );
  }
  return tag.slice(1);
}

export function npmDistTag(tag: string): "latest" | "beta" {
  versionFromTag(tag);
  return tag.includes("-") ? "beta" : "latest";
}

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

type PackedPackage = {
  filename?: string;
  files?: Array<{ path?: string }>;
};

export type PackedManifest = PackedPackage[] | Record<string, PackedPackage>;

export function packedManifest(
  packed: PackedManifest,
): PackedPackage | undefined {
  return Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
}

export function packedFilePaths(packed: PackedManifest): Set<string> {
  const manifest = packedManifest(packed);
  const paths = manifest?.files?.flatMap((file) =>
    file.path === undefined ? [] : [file.path],
  );
  return new Set(paths);
}

export function checkReleaseManifests(root: string, tag: string): string[] {
  const errors: string[] = [];
  const version = versionFromTag(tag);
  const repository = "https://github.com/LamplitIsles/kepos-imagegen.git";
  const core = readJson(join(root, "packages/imagegen-core/package.json"));
  if (core.private !== true) {
    errors.push("@lamplitisles/imagegen-core must remain private.");
  }

  for (const entry of PUBLIC_PACKAGES) {
    const manifest = readJson(
      join(root, "packages", entry.directory, "package.json"),
    );
    if (manifest.name !== entry.name)
      errors.push(`${entry.directory} has the wrong npm name.`);
    if (manifest.version !== version)
      errors.push(`${entry.name} version does not match ${tag}.`);
    const manifestRepository = manifest.repository as
      { url?: unknown } | undefined;
    if (manifestRepository?.url !== repository)
      errors.push(`${entry.name} has the wrong repository.`);
    const publishConfig = manifest.publishConfig as
      { registry?: unknown; access?: unknown } | undefined;
    if (
      publishConfig?.registry !== "https://registry.npmjs.org" ||
      publishConfig.access !== "public"
    ) {
      errors.push(`${entry.name} must publish publicly to npm.`);
    }
    if (JSON.stringify(manifest).includes("workspace:"))
      errors.push(`${entry.name} leaks a workspace protocol.`);
    if (
      manifest.dependencies !== undefined ||
      manifest.optionalDependencies !== undefined
    ) {
      errors.push(`${entry.name} must not have runtime dependencies.`);
    }
    const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
    if (
      ["install", "preinstall", "postinstall"].some((name) => name in scripts)
    ) {
      errors.push(`${entry.name} must not have install hooks.`);
    }
  }
  return errors;
}

export function checkPackedManifests(root: string): string[] {
  const errors: string[] = [];
  for (const entry of PUBLIC_PACKAGES) {
    const packageDirectory = join(root, "packages", entry.directory);
    if (
      entry.requiredFiles.some(
        (file) => !existsSync(join(packageDirectory, file)),
      )
    ) {
      errors.push(`${entry.name} is not built before release preflight.`);
      continue;
    }
    let packed: PackedManifest;
    try {
      packed = JSON.parse(
        execFileSync("npm", ["pack", "--json", "--dry-run"], {
          cwd: packageDirectory,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ) as PackedManifest;
    } catch {
      errors.push(`${entry.name} could not produce a packed manifest.`);
      continue;
    }
    const files = packedFilePaths(packed);
    for (const required of entry.requiredFiles) {
      if (!files.has(required))
        errors.push(`${entry.name} packed manifest omits ${required}.`);
    }
    if (
      [...files].some(
        (file) => file?.includes("node_modules") || file?.endsWith(".tgz"),
      )
    ) {
      errors.push(
        `${entry.name} packed manifest contains an unsafe build artifact.`,
      );
    }
  }
  return errors;
}
