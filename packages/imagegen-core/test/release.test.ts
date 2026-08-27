import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { releaseCheck } from "../../../scripts/release-check.js";
import { npmDistTag, versionFromTag } from "../../../scripts/release-shared.js";
import { synchronizeReleaseVersions } from "../../../scripts/sync-release-version.js";

const fixtures: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kepos-imagegen-release-"));
  fixtures.push(root);
  const packageJson = {
    version: "0.1.0",
    repository: {
      type: "git",
      url: "https://github.com/LamplitIsles/kepos-imagegen.git",
    },
    publishConfig: { registry: "https://registry.npmjs.org", access: "public" },
  };
  await mkdir(join(root, "packages/imagegen-core"), { recursive: true });
  await mkdir(join(root, "packages/dsh-imagegen"), { recursive: true });
  await mkdir(join(root, "packages/pi-imagegen"), { recursive: true });
  await writeFile(
    join(root, "packages/imagegen-core/package.json"),
    JSON.stringify({ private: true }),
  );
  await writeFile(
    join(root, "packages/dsh-imagegen/package.json"),
    JSON.stringify({ ...packageJson, name: "@lamplitisles/dsh-imagegen" }),
  );
  await writeFile(
    join(root, "packages/pi-imagegen/package.json"),
    JSON.stringify({ ...packageJson, name: "@lamplitisles/pi-imagegen" }),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("release invariants", () => {
  it("accepts matching stable and prerelease tags and chooses their npm channels", async () => {
    const root = await fixture();
    expect(releaseCheck(root, "v0.1.0", false)).toEqual([]);
    expect(versionFromTag("v0.1.0-beta.1")).toBe("0.1.0-beta.1");
    expect(npmDistTag("v0.1.0")).toBe("latest");
    expect(npmDistTag("v0.1.0-beta.1")).toBe("beta");
    expect(() => versionFromTag("release-0.1.0")).toThrow("v<semver>");
  });

  it("rejects a package version that does not match the release tag", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "packages/pi-imagegen/package.json"),
      JSON.stringify({
        name: "@lamplitisles/pi-imagegen",
        version: "0.1.1",
        repository: {
          type: "git",
          url: "https://github.com/LamplitIsles/kepos-imagegen.git",
        },
        publishConfig: {
          registry: "https://registry.npmjs.org",
          access: "public",
        },
      }),
    );
    expect(releaseCheck(root, "v0.1.0", false)).toContain(
      "@lamplitisles/pi-imagegen version does not match v0.1.0.",
    );
  });

  it("synchronizes both public package versions from a prerelease tag", async () => {
    const root = await fixture();
    await synchronizeReleaseVersions(root, "v0.1.0-beta.1");
    for (const directory of ["dsh-imagegen", "pi-imagegen"]) {
      const manifest = JSON.parse(
        await readFile(
          join(root, `packages/${directory}/package.json`),
          "utf8",
        ),
      );
      expect(manifest.version).toBe("0.1.0-beta.1");
    }
    expect(releaseCheck(root, "v0.1.0-beta.1", false)).toEqual([]);
  });
});
