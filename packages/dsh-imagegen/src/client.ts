import {
  DEFAULT_BRIDGE_URL,
  normalizeBridgeUrl,
} from "@lamplitisles/imagegen-core";
import type {
  SettingsScope as DshSettingsScope,
  SettingsScopeSnapshot,
  SettingsScopeSpec,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { ISessions } from "@deepseek-ai/dsh-client-runtime/client";
import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import type { ToolCallViewProps } from "@deepseek-ai/dsh-client-ui-tool/client";
import { createElement, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export const SETTINGS_NAMESPACE = "lamplitisles-kepos-imagegen";
export const inject = ["sessions", "settingsScope", "slots"] as const;

export interface ClientSettings {
  bridgeUrl?: string;
}

export type SettingsScope = Pick<
  DshSettingsScope<ClientSettings>,
  "getSnapshot" | "subscribe" | "set"
>;

type ClientContext = {
  sessions: Pick<ISessions, "binding">;
  settingsScope: {
    bind(spec: SettingsScopeSpec<ClientSettings>): SettingsScope;
  };
  slots: {
    inject(name: string, callback: () => unknown): void;
    register(
      spec: { name: string; key: string; inject: () => object },
      content: unknown,
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
  ctx.slots.inject("tool.call.toolview", () =>
    ctx.slots.register(
      {
        name: "tool.call.toolview",
        key: "kepos_image_generate",
        inject: () => ({}),
      },
      (props: ToolCallViewProps) =>
        createElement(ImageToolCard, { ...props, sessions: ctx.sessions }),
    ),
  );
}

type ImageToolCardProps = ToolCallViewProps & {
  sessions: Pick<ISessions, "binding">;
};

function ImageToolCard({ block, sessionId, sessions }: ImageToolCardProps) {
  const attachment = imageAttachmentFromBlock(block);
  const [src, setSrc] = useState<string>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!attachment) return;
    const session = sessions.binding(sessionId)?.session;
    if (!session) return;
    let live = true;
    let objectUrl: string | undefined;
    setSrc(undefined);
    setLoadFailed(false);
    session.readAttachment(attachment.attachmentId).then((result) => {
      if (!result.ok || !live) {
        if (live) setLoadFailed(true);
        return;
      }
      objectUrl = URL.createObjectURL(
        new Blob([new Uint8Array(result.value.data)], {
          type: result.value.attachment.mediaType,
        }),
      );
      setSrc(objectUrl);
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, sessionId, sessions]);

  useEffect(() => {
    if (!previewOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [previewOpen]);

  if (!isToolResult(block)) {
    return createElement("p", { style: cardStyle }, "Generating image…");
  }
  if (block.isError || !attachment) {
    return createElement(
      "p",
      { style: cardStyle },
      block.error
        ? `Image generation failed: ${block.error.name}.`
        : "Image generation failed.",
    );
  }
  const name = attachment.name ?? "kepos-image.png";
  const download = () => {
    if (!src) return;
    const link = document.createElement("a");
    link.href = src;
    link.download = name;
    link.click();
  };
  return createElement(
    "section",
    { style: cardStyle, "aria-label": "Generated Kepos image" },
    createElement("p", { style: statusStyle }, "Image generated"),
    loadFailed
      ? createElement("p", null, "Could not load the image preview.")
      : createElement(
          "button",
          {
            type: "button",
            disabled: !src,
            onClick: () => setPreviewOpen(true),
            title: "Open image preview",
            style: imageButtonStyle,
          },
          src
            ? createElement("img", {
                src,
                alt: name,
                style: imageStyle,
              })
            : "Loading image…",
        ),
    createElement(
      "div",
      { style: actionStyle },
      createElement("code", { style: pathStyle }, outputPath(block)),
      createElement(
        "button",
        { type: "button", onClick: download, disabled: !src },
        "Download PNG",
      ),
    ),
    previewOpen && src
      ? createPortal(
          createElement(
            "div",
            {
              role: "dialog",
              "aria-modal": true,
              "aria-label": "Image preview",
              style: lightboxStyle,
            },
            createElement("div", {
              "aria-hidden": true,
              onMouseDown: () => setPreviewOpen(false),
              style: backdropStyle,
            }),
            createElement("img", { src, alt: name, style: previewStyle }),
            createElement(
              "button",
              {
                type: "button",
                onClick: () => setPreviewOpen(false),
                style: closeStyle,
              },
              "Close",
            ),
          ),
          document.body,
        )
      : null,
  );
}

function imageAttachmentFromBlock(
  block: ToolCallViewProps["block"],
): ImageAttachmentRef | undefined {
  if (!isToolResult(block)) return undefined;
  const image = block.content.find((item) => item.type === "image");
  return image?.type === "image" ? image.attachment : undefined;
}

function outputPath(block: ToolCallViewProps["block"]): string {
  if (!isToolResult(block)) return "Saving to workspace…";
  const text = block.content.find((item) => item.type === "text");
  const match =
    text?.type === "text" ? /saved to (.+)\.$/.exec(text.text) : null;
  return match?.[1] ?? ".dsh/kepos-imagegen";
}

function isToolResult(
  block: ToolCallViewProps["block"],
): block is Extract<ToolCallViewProps["block"], { kind: "tool-result" }> {
  return "kind" in block && block.kind === "tool-result";
}

const cardStyle = {
  display: "grid",
  gap: "10px",
  maxWidth: "360px",
  padding: "12px",
  border: "1px solid var(--dsw-alias-border-l2-darkmode-thin, #d7d7d7)",
  borderRadius: "12px",
  background: "var(--dsw-specific-input-major, #fff)",
} as const;
const statusStyle = { margin: 0, fontWeight: 600 } as const;
const imageButtonStyle = {
  padding: 0,
  overflow: "hidden",
  border: 0,
  borderRadius: "8px",
  cursor: "zoom-in",
  background: "transparent",
} as const;
const imageStyle = {
  display: "block",
  width: "100%",
  maxHeight: "280px",
  objectFit: "contain",
  background: "#111",
} as const;
const actionStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  justifyContent: "space-between",
} as const;
const pathStyle = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "12px",
} as const;
const lightboxStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "grid",
  placeItems: "center",
  padding: "40px",
} as const;
const backdropStyle = {
  position: "absolute",
  inset: 0,
  background: "rgba(0, 0, 0, 0.78)",
} as const;
const previewStyle = {
  position: "relative",
  maxWidth: "min(100%, 1600px)",
  maxHeight: "calc(100vh - 80px)",
  objectFit: "contain",
  borderRadius: "12px",
} as const;
const closeStyle = { position: "fixed", top: "20px", right: "20px" } as const;

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
