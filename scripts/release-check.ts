import {
  checkPackedManifests,
  checkReleaseManifests,
  npmDistTag,
} from "./release-shared.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function releaseCheck(
  root: string,
  tag: string,
  checkPacked = true,
): string[] {
  const errors = checkReleaseManifests(root, tag);
  if (checkPacked) errors.push(...checkPackedManifests(root));
  return errors;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const tag = process.env.GITHUB_REF_NAME;
  if (!tag) throw new Error("GITHUB_REF_NAME must contain the release tag.");
  const errors = releaseCheck(process.cwd(), tag);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  console.log(`Release preflight passed (${npmDistTag(tag)}).`);
}
