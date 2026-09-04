# Kepos Image Generation for DSH

Install it in a DSH profile:

```sh
dsh plugin --profile <profile> add @lamplitisles/dsh-imagegen
```

This package targets the DSH `0.1.2-rc.1` API contract.

Open DSH Settings and use **Kepos Image Generation** to set the bridge address. The
tool generates when `images` is omitted and edits one through five PNG, JPEG, GIF,
or WebP files named relative to the active workspace. Kepos owns authentication;
this plugin does not accept or store credentials.

Every generated image is saved under `.dsh/kepos-imagegen/` in the active
workspace. The returned relative path can be used in a later image-edit call;
the DSH tool card also provides a preview and PNG download.
