# Kepos Image Generation for DSH

Install it in a DSH profile:

```sh
dsh plugin --profile <profile> add @kepos/dsh-imagegen
```

Open DSH Settings and use **Kepos Image Generation** to set the bridge address. The
tool generates when `images` is omitted and edits one through five PNG, JPEG, GIF,
or WebP files named relative to the active workspace. Kepos owns authentication;
this plugin does not accept or store credentials.
