import { DEFAULT_BRIDGE_URL, normalizeBridgeUrl } from "@kepos/imagegen-core";
import type {
  SettingsScope as DshSettingsScope,
  SettingsScopeSnapshot,
  SettingsScopeSpec,
} from "@deepseek-ai/dsh-client-runtime/client";
import { IconChevronDownOutline14 } from "@deepseek-ai/dsh-client-ui-primitives";
import { createElement, useEffect, useId, useState } from "react";
import styles from "./settings.module.dshcss";

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
  const [open, setOpen] = useState(false);
  const cardId = useId();

  useEffect(
    () => scope.subscribe(() => setSnapshot(scope.getSnapshot())),
    [scope],
  );
  const saved = bridgeUrlFromSnapshot(snapshot);
  const dirty = draft !== saved;
  useEffect(() => setDraft(bridgeUrlFromSnapshot(snapshot)), [snapshot]);

  const save = async () => {
    setFeedback(undefined);
    try {
      setSaving(true);
      await saveBridgeUrl(scope, draft);
      setFeedback(undefined);
    } catch {
      setFeedback("Enter a valid Kepos bridge address.");
    } finally {
      setSaving(false);
    }
  };

  return createElement(
    "li",
    {
      className: `${styles.card} ${open ? styles.open : ""}`,
      "data-settings-card": SETTINGS_NAMESPACE,
    },
    createElement(
      "button",
      {
        type: "button",
        className: styles.header,
        "aria-expanded": open,
        "aria-controls": `${cardId}-body`,
        onClick: () => setOpen((value) => !value),
      },
      createElement(
        "span",
        { className: styles.headText },
        createElement(
          "span",
          { className: styles.name },
          "Kepos Image Generation",
        ),
        createElement(
          "span",
          { className: styles.description },
          "Bridge used for generated image attachments.",
        ),
      ),
      dirty
        ? createElement("span", { className: styles.pending }, "Unsaved")
        : null,
      createElement(IconChevronDownOutline14, {
        className: `${styles.chevron} ${open ? styles.chevronOpen : ""}`,
      }),
    ),
    open
      ? createElement(
          "div",
          { className: styles.body, id: `${cardId}-body` },
          createElement(
            "div",
            { className: styles.field },
            createElement(
              "label",
              { className: styles.label, htmlFor: `${cardId}-bridge` },
              "Kepos bridge address",
            ),
            createElement("input", {
              className: styles.control,
              id: `${cardId}-bridge`,
              type: "text",
              value: draft,
              disabled: saving || !snapshot.writable,
              onChange: (event: { target: { value: string } }) => {
                setDraft(event.target.value);
                setFeedback(undefined);
              },
            }),
            createElement(
              "p",
              { className: styles.hint },
              "The plugin appends /codex/images to this address.",
            ),
          ),
          createElement(
            "div",
            { className: styles.footer },
            feedback
              ? createElement(
                  "p",
                  { className: styles.error, role: "alert" },
                  feedback,
                )
              : null,
            createElement(
              "button",
              {
                className: styles.discard,
                type: "button",
                disabled: !dirty || saving,
                onClick: () => {
                  setDraft(saved);
                  setFeedback(undefined);
                },
              },
              "Discard",
            ),
            createElement(
              "button",
              {
                className: styles.save,
                type: "button",
                onClick: () => void save(),
                disabled: !dirty || saving || !snapshot.writable,
              },
              saving ? "Saving…" : "Save",
            ),
          ),
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
