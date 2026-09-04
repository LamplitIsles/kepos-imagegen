# 01 — Run DSH Imagegen on the rc.1 package contract

**What to build:** The DSH Imagegen artifact installs and generates images using one exact 0.1.2-rc.1 package contract.

**Blocked by:** None — can start immediately

Status: complete

- [x] Move DSH Imagegen's owned peers, development dependencies, lockfile, and version-bearing smoke contracts to 0.1.2-rc.1 without changing the Pi package contract.
- [x] Preserve current image-generation behavior and package composition.
- [x] Pass DSH unit tests, typecheck, packed-artifact smoke, and disposable 0.1.2-rc.1 link smoke using test-owned state.
