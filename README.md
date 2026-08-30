# Kepos Image Generation

Native image generation and editing adapters for the Kepos bridge. The bridge
uses its managed OAuth and always selects `gpt-image-2`; neither adapter asks
for, stores, or forwards an API key, cookie, token, or other credential.

## Install for DSH

```sh
dsh plugin --profile <profile> add @lamplitisles/dsh-imagegen
```

Open DSH Settings and select **Kepos Image Generation** to view or change the
bridge address. The default is `http://codex-bridge.localhost:17480`; the
adapter appends `/codex/images` itself.

## Install for Pi

```sh
pi install npm:@lamplitisles/pi-imagegen
```

Run `/kepos-image-settings` in Pi to view or change the global bridge address.
Interactive TUI and RPC modes can change it; noninteractive mode reports the
current address and explains that interactive UI is required. Pi stores only
`bridgeUrl` in its global `kepos-imagegen.json` agent configuration file.

## Image edits

Both adapters expose `kepos_image_generate`. Omit `images` to generate a PNG.
For an edit, pass one through five PNG, JPEG, GIF, or WebP paths relative to the
active DSH workspace or Pi current working directory. Paths outside that
directory, including symlink escapes, are rejected. DSH also saves each result
as a PNG under `.dsh/kepos-imagegen/` and returns that relative path alongside
its native attachment. Pi returns an image content block and does not write an
output file.

## Maintainer release setup

The GitHub workflow publishes a matching tagged release of the two public
packages. Before the first beta publication, a maintainer must:

1. Create the `@lamplitisles` npm scope and manually publish the initial beta for both
   `@lamplitisles/dsh-imagegen` and `@lamplitisles/pi-imagegen`.
2. Configure npm Trusted Publishing for each package identity, this repository,
   the `.github/workflows/release.yml` workflow, and the protected `npm`
   environment.
3. Create the protected GitHub `npm` environment with the required release
   policy.

Then push a `v<semver>` tag. Stable tags publish with npm's `latest` tag and
prerelease tags publish with `beta`. The workflow uses OIDC provenance; no npm
token is stored in this repository.

## Development

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
GITHUB_REF_NAME=v0.1.0 pnpm release:check
pnpm test:pack
```

These checks use fakes and test-owned temporary directories. They never call a
live Kepos bridge or publish packages.
