# DSH Imagegen 0.1.2-rc.1 implementation report

Status: complete
Date: 2026-09-04
Implementation commit: `ffc6b76` (`feat(dsh-imagegen): retarget DSH contract to rc.1`)
Amendment fixed point: `55c98a4` (`chore(imagegen): retarget DSH upgrade to rc.1`)

## Delivered

- Updated every owned DSH Imagegen peer and development dependency to the exact
  `0.1.2-rc.1` contract while leaving the Pi package contract unchanged.
- Regenerated the pnpm lockfile and workspace release-age exceptions for the
  complete DSH rc.1 family. The lockfile contains no stale alpha-version entries;
  the active workspace graph resolves 53 DSH package names, all at rc.1.
- Updated the packed-artifact and disposable link smoke assertions to require
  `0.1.2-rc.1`. The existing image-generation behavior, package composition,
  and retired client-runtime exclusion remain unchanged.
- Documented the exact rc.1 contract in the root and DSH package READMEs. The
  repository has no tracked `AGENTS.md`; its agent workflow and conventions did
  not change, so no agent-guidance update was needed.

## Acceptance and verification

All checks were run from the repository root with frozen/test-owned state:

```text
pnpm install --lockfile-only                       # passed
pnpm install --frozen-lockfile --ignore-scripts     # passed
pnpm format:check                                  # passed
pnpm typecheck                                     # passed
pnpm test:dsh                                      # 11 tests passed
pnpm test                                          # 28 tests passed
pnpm build                                         # passed
pnpm test:pack                                     # Packed-artifact smoke checks passed.
DSH_CLI=<temporary official @deepseek-ai/dsh@0.1.2-rc.1> pnpm test:dsh-link # passed
```

The link smoke used the published `@deepseek-ai/dsh@0.1.2-rc.1` executable
installed into a disposable npm directory. Its real installed graph contained
214 DSH packages, with zero non-rc.1 versions. The smoke created and removed
its own `DSH_HOME`, profile, workspace, and package caches. No live bridge,
credentials, or user DSH profile was accessed. Vitest emits only the known
upstream missing-source-map warning for `dsh-client-ui-primitives`.

## LOC variance

The spec estimated 25–70 changed lines. Against the amendment fixed point
`55c98a4`, excluding `pnpm-lock.yaml` and generated files, the rc.1 retarget
contains 0 product-code additions/deletions, 14 smoke-test additions/deletions,
and 283 configuration/documentation additions/deletions (297 changed lines,
including this report). The configuration variance comes
from replacing the complete workspace release-age exception list, refreshing
the lockfile contract metadata, and reopening/completing the two tickets and
spec for the authoritative rc.1 amendment.

## Remaining concerns

- No compatibility layer, runtime override, publishing action, or image
  generation behavior change was introduced.
- Code review and deployment were not performed; they are outside this
  implementation request.
