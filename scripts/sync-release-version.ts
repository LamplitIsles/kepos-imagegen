import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PUBLIC_PACKAGES, versionFromTag } from "./release-shared.js";

export async function synchronizeReleaseVersions(
  root: string,
  tag: string,
): Promise<void> {
  const version = versionFromTag(tag);
  await Promise.all(
    PUBLIC_PACKAGES.map(async (entry) => {
      const path = join(root, "packages", entry.directory, "package.json");
      const manifest = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
      >;
      manifest.version = version;
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const tag = process.env.GITHUB_REF_NAME;
  if (!tag) throw new Error("GITHUB_REF_NAME must contain the release tag.");
  await synchronizeReleaseVersions(process.cwd(), tag);
}
