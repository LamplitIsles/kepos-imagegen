import {
  DEFAULT_BRIDGE_URL,
  normalizeBridgeUrl,
} from "@lamplitisles/imagegen-core";
import type {
  SettingsScope as DshSettingsScope,
  SettingsScopeSnapshot,
  SettingsScopeSpec,
} from "@deepseek-ai/dsh-client-runtime/client";
import { createElement, useEffect, useState } from "react";

export const SETTINGS_NAMESPACE = "lamplitisles-kepos-imagegen";
export const inject = ["settingsScope", "slots"] as const;

export interface ClientSettings {
  bridgeUrl?: string;
}

export type SettingsScope = Pick<
  DshSettingsScope<ClientSettings>,
  "getSnapshot" | "subscribe" | "set"
>;

type ClientContext = {
  settingsScope: {
    bind(spec: SettingsScopeSpec<ClientSettings>): SettingsScope;
  };
  slots: {
    inject(name: string, callback: () => unknown): void;
    register(
      spec: { name: string; key: string; inject: () => object },
      content: () => unknown,
    ): unknown;
  };
};

export function decodeSettings(value: unknown): ClientSettings {
  if (typeof value !== "object" || value === null) {
    return { bridgeUrl: DEFAULT_BRIDGE_URL };
  }
  const bridgeUrl = (value as { bridgeUrl?: unknown }).bridgeUrl;
  return { bridgeUrl: validOrDefault(bridgeUrl) };
}

export async function saveBridgeUrl(
  scope: SettingsScope,
  value: string,
): Promise<string> {
  const bridgeUrl = normalizeBridgeUrl(value);
  await scope.set("bridgeUrl", bridgeUrl);
  return bridgeUrl;
}

export function bridgeUrlFromSnapshot(
  snapshot: SettingsScopeSnapshot<ClientSettings>,
): string {
  return validOrDefault(snapshot.value?.bridgeUrl);
}

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind({
    namespace: SETTINGS_NAMESPACE,
    decode: decodeSettings,
  });
  ctx.slots.inject("settings.plugin.item", () =>
    ctx.slots.register(
      {
        name: "settings.plugin.item",
        key: SETTINGS_NAMESPACE,
        inject: () => ({}),
      },
      () => createElement(SettingsCard, { scope }),
    ),
  );
}

function SettingsCard({ scope }: { scope: SettingsScope }) {
  const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
  const [draft, setDraft] = useState(() => bridgeUrlFromSnapshot(snapshot));
  const [feedback, setFeedback] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(
    () => scope.subscribe(() => setSnapshot(scope.getSnapshot())),
    [scope],
  );
  useEffect(() => setDraft(bridgeUrlFromSnapshot(snapshot)), [snapshot]);

  const save = async () => {
    setFeedback(undefined);
    try {
      setSaving(true);
      await saveBridgeUrl(scope, draft);
      setFeedback("Saved.");
    } catch {
      setFeedback("Enter a valid Kepos bridge address.");
    } finally {
      setSaving(false);
    }
  };

  return createElement(
    "section",
    { "aria-labelledby": "kepos-image-settings-title" },
    createElement(
      "h2",
      { id: "kepos-image-settings-title" },
      "Kepos Image Generation",
    ),
    createElement(
      "p",
      null,
      "The Kepos bridge appends /codex/images to this address.",
    ),
    createElement(
      "label",
      { htmlFor: "kepos-image-bridge-url" },
      "Kepos bridge address",
    ),
    createElement("input", {
      id: "kepos-image-bridge-url",
      type: "text",
      value: draft,
      onChange: (event: { target: { value: string } }) =>
        setDraft(event.target.value),
    }),
    createElement(
      "button",
      { type: "button", onClick: () => void save(), disabled: saving },
      saving ? "Saving…" : "Save",
    ),
    feedback
      ? createElement(
          "p",
          { role: feedback === "Saved." ? "status" : "alert" },
          feedback,
        )
      : null,
  );
}

function validOrDefault(value: unknown): string {
  try {
    return normalizeBridgeUrl(
      typeof value === "string" ? value : DEFAULT_BRIDGE_URL,
    );
  } catch {
    return DEFAULT_BRIDGE_URL;
  }
}
