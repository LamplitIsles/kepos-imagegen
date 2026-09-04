Status: complete

## Target Amendment — 0.1.2-rc.1

This amendment supersedes every earlier alpha.5 target in this spec and tickets. Pin the DSH Imagegen direct peer/dev contract, lockfile, scripts, documentation, and disposable smoke to exactly 0.1.2-rc.1. Preserve the Pi package contract and do not add runtime overrides or old-version compatibility.

## Problem Statement

The DSH Imagegen package and its pack/link smoke scripts must share the official
DSH 0.1.2-rc.1 contract so the artifact can be built and verified against the
current release candidate.

## Solution

Move the DSH Imagegen package, workspace lockfile, and its exact-version smoke
contracts to 0.1.2-rc.1 while preserving image generation behavior.

## User Stories

1. As an Imagegen user, I can install its DSH package with an exact 0.1.2-rc.1 contract.
2. As a maintainer, I can validate the packed package and disposable DSH link against the official 0.1.2-rc.1 CLI.

## Delivery Boundary

This spec is implemented and reviewed as one PR. It may be decomposed into multiple tickets on the same branch when that makes execution easier.

## Implementation Decisions

- Upgrade only the DSH Imagegen package and the workspace metadata it owns; do not change the Pi package contract.
- Keep one exact 0.1.2-rc.1 DSH version across peers, dev dependencies, lockfile, and script assertions.
- Do not add session compatibility code: no removed Session API is currently used.
- Documentation and agent guidance: inspect the package README and repository AGENTS.md. Update version claims to 0.1.2-rc.1; record why AGENTS.md needs no update when absent or unchanged.

## Testing Decisions

Run the existing DSH-specific unit tests, typecheck, packed-artifact smoke, and disposable DSH link smoke. Keep all generated images and DSH homes test-owned.

## Estimated Changed LOC

Product code 0-5, tests 5-20, configuration/docs 20-45; total 25-70. Assumes the existing APIs typecheck unchanged on 0.1.2-rc.1.

## Out of Scope

Image generation behavior changes, publishing, supporting old DSH versions, and updating unrelated workspace packages.

## Further Notes

Shared cross-repository acceptance summary: every owned direct DSH plugin must ship one exact 0.1.2-rc.1 peer/dev contract, refreshed lockfile and version-bearing package/test/docs assertions, and its existing highest-value package verification. Companion alone has a known alpha.4 API migration; no compatibility layer is required.
