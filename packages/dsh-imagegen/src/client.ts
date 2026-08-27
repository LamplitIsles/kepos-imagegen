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
import cssText from "./client.css";

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
  effect(callback: () => void | (() => void), name?: string): void;
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
  ctx.effect(() => installStyles(cssText), "kepos-imagegen: styles");
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
    return createElement(
      "p",
      { className: "kepos-imagegen__notice" },
      "Generating image…",
    );
  }
  if (block.isError || !attachment) {
    return createElement(
      "p",
      { className: "kepos-imagegen__notice", role: "alert" },
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
    {
      className: "kepos-imagegen__card",
      "aria-label": "Generated Kepos image",
    },
    createElement(
      "p",
      { className: "kepos-imagegen__status" },
      "Image generated",
    ),
    loadFailed
      ? createElement("p", null, "Could not load the image preview.")
      : createElement(
          "button",
          {
            type: "button",
            disabled: !src,
            onClick: () => setPreviewOpen(true),
            title: "Open image preview",
            className: "kepos-imagegen__thumbnail",
          },
          src
            ? createElement("img", {
                src,
                alt: name,
                className: "kepos-imagegen__image",
              })
            : "Loading image…",
        ),
    createElement(
      "div",
      { className: "kepos-imagegen__actions" },
      createElement(
        "code",
        { className: "kepos-imagegen__path", title: outputPath(block) },
        outputPath(block),
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: download,
          disabled: !src,
          className: "kepos-imagegen__button",
        },
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
              className: "kepos-imagegen__lightbox",
            },
            createElement("div", {
              "aria-hidden": true,
              onMouseDown: () => setPreviewOpen(false),
              className: "kepos-imagegen__backdrop",
            }),
            createElement("img", {
              src,
              alt: name,
              className: "kepos-imagegen__preview",
            }),
            createElement(
              "button",
              {
                type: "button",
                onClick: () => setPreviewOpen(false),
                className: "kepos-imagegen__close",
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
    {
      className: "kepos-imagegen__settings",
      "aria-labelledby": "kepos-image-settings-title",
    },
    createElement(
      "h2",
      {
        id: "kepos-image-settings-title",
        className: "kepos-imagegen__settings-title",
      },
      "Kepos Image Generation",
    ),
    createElement(
      "p",
      { className: "kepos-imagegen__settings-copy" },
      "The Kepos bridge appends /codex/images to this address.",
    ),
    createElement(
      "label",
      {
        htmlFor: "kepos-image-bridge-url",
        className: "kepos-imagegen__label",
      },
      "Kepos bridge address",
    ),
    createElement("input", {
      id: "kepos-image-bridge-url",
      type: "text",
      value: draft,
      className: "kepos-imagegen__input",
      onChange: (event: { target: { value: string } }) =>
        setDraft(event.target.value),
    }),
    createElement(
      "button",
      {
        type: "button",
        onClick: () => void save(),
        disabled: saving,
        className: "kepos-imagegen__button",
      },
      saving ? "Saving…" : "Save",
    ),
    feedback
      ? createElement(
          "p",
          {
            role: feedback === "Saved." ? "status" : "alert",
            className: "kepos-imagegen__feedback",
            "data-state": feedback === "Saved." ? "success" : "error",
          },
          feedback,
        )
      : null,
  );
}

function installStyles(css: string): () => void {
  const style = document.createElement("style");
  style.dataset.dshPlugin = "kepos-imagegen";
  style.textContent = css;
  document.head.append(style);
  return () => style.remove();
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
