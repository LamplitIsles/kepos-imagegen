import {
  DEFAULT_BRIDGE_URL,
  ImagegenError,
  assertNonblankPrompt,
  encodeImageDataUrl,
  isSupportedMediaType,
  normalizeBridgeUrl,
  remainingSourceBytes,
  requestImage,
  type ImageMediaType,
  type RequestImageOptions,
} from "@kepos/imagegen-core";
import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "typebox";

export const TOOL_NAME = "kepos_image_generate";
export const SETTINGS_COMMAND = "kepos-image-settings";
export const CONFIG_FILE_NAME = "kepos-imagegen.json";

export interface FileOperations {
  realpath(path: string): Promise<string>;
  readImage(path: string, maxBytes: number): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  writeText(path: string, value: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface PiDependencies {
  fs?: FileOperations;
  getAgentDirectory?: () => string;
  fetch?: typeof globalThis.fetch;
  request?: (options: RequestImageOptions) => ReturnType<typeof requestImage>;
}

const nodeFileOperations: FileOperations = {
  realpath,
  async readImage(path, maxBytes) {
    const handle = await open(path, "r");
    try {
      if (!(await handle.stat()).isFile()) {
        throw invalidSourceImage();
      }
      const buffer = new Uint8Array(maxBytes + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.byteLength) {
        const read = await handle.read(
          buffer,
          bytesRead,
          buffer.byteLength - bytesRead,
          bytesRead,
        );
        if (read.bytesRead === 0) break;
        bytesRead += read.bytesRead;
      }
      if (bytesRead === 0 || bytesRead > maxBytes) {
        throw invalidSourceImage();
      }
      return buffer.slice(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
  async readText(path) {
    return readFile(path, "utf8");
  },
  async writeText(path, value) {
    await writeFile(path, value, "utf8");
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
};

function invalidSourceImage(): ImagegenError {
  return new ImagegenError(
    "A source image is invalid or too large for the Kepos bridge.",
  );
}

const toolParameters = Type.Object(
  {
    prompt: Type.String({
      minLength: 1,
      description: "A nonblank image-generation prompt.",
    }),
    images: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: 5,
        description:
          "One through five paths relative to Pi's current working directory.",
      }),
    ),
  },
  { additionalProperties: false },
);

export default function extension(pi: ExtensionAPI): void {
  installPiImagegen(pi);
}

export function installPiImagegen(
  pi: ExtensionAPI,
  dependencies: PiDependencies = {},
): void {
  const fs = dependencies.fs ?? nodeFileOperations;
  const getAgentDirectory = dependencies.getAgentDirectory ?? getAgentDir;
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const request = dependencies.request ?? requestImage;
  const configPath = join(getAgentDirectory(), CONFIG_FILE_NAME);

  pi.registerTool({
    name: TOOL_NAME,
    label: "Kepos image generation",
    description:
      "Generate a PNG with Kepos. To edit, supply one through five PNG, JPEG, GIF, or WebP paths relative to Pi's current working directory; omit images to generate.",
    parameters: toolParameters,
    executionMode: "sequential",
    async execute(_toolCallId, args, signal, _onUpdate, ctx) {
      try {
        assertNonblankPrompt(args.prompt);
        const sourceUrls = args.images
          ? await readPiSources(args.images, args.prompt, ctx.cwd, signal, fs)
          : undefined;
        const bridgeUrl = await readBridgeUrl(configPath, fs);
        const requestOptions: RequestImageOptions = {
          fetch: fetchImplementation,
          prompt: args.prompt,
          baseUrl: bridgeUrl,
        };
        if (sourceUrls !== undefined) requestOptions.images = sourceUrls;
        if (signal !== undefined) requestOptions.signal = signal;
        const result = await request(requestOptions);
        return {
          content: [
            { type: "text", text: "Generated image." },
            {
              type: "image",
              data: toBase64(result.data),
              mimeType: "image/png",
            },
          ],
          details: { imageCount: sourceUrls?.length ?? 0 },
        };
      } catch (error) {
        throw safePiError(error);
      }
    },
  });

  pi.registerCommand(SETTINGS_COMMAND, {
    description: "View or change the Kepos image bridge address.",
    async handler(_args, ctx) {
      const current = await readBridgeUrl(configPath, fs);
      if (!ctx.hasUI) {
        ctx.ui.notify(
          `Kepos image bridge: ${current}. Interactive UI is required to change it.`,
          "info",
        );
        return;
      }
      const next = await ctx.ui.input("Kepos image bridge address", current);
      if (next === undefined) {
        return;
      }
      try {
        const bridgeUrl = normalizeBridgeUrl(next);
        await writeBridgeUrl(configPath, bridgeUrl, fs);
        ctx.ui.notify("Kepos image bridge address saved.", "info");
      } catch {
        ctx.ui.notify("Enter a valid Kepos bridge address.", "error");
      }
    },
  });
}

async function readPiSources(
  images: readonly string[],
  prompt: string,
  cwd: string,
  signal: AbortSignal | undefined,
  fs: FileOperations,
): Promise<string[]> {
  if (images.length === 0 || images.length > 5) {
    throw new ImagegenError(
      "Provide between one and five relative source image paths.",
    );
  }
  const canonicalCwd = await fs.realpath(cwd);
  const sourceUrls: string[] = [];
  for (const image of images) {
    if (typeof image !== "string" || image.trim() === "" || isAbsolute(image)) {
      throw new ImagegenError(
        "Source image paths must be relative to Pi's current working directory.",
      );
    }
    const mediaType = mediaTypeForPath(image);
    const candidate = await fs.realpath(resolve(cwd, image));
    const pathFromCwd = relative(canonicalCwd, candidate);
    if (
      pathFromCwd === "" ||
      pathFromCwd.startsWith("..") ||
      isAbsolute(pathFromCwd)
    ) {
      throw new ImagegenError(
        "Source image paths must stay inside Pi's current working directory.",
      );
    }
    const maxBytes = remainingSourceBytes(prompt, sourceUrls, mediaType);
    if (maxBytes === 0) {
      throw new ImagegenError(
        "The image request is too large for the Kepos bridge.",
      );
    }
    const data = await fs.readImage(candidate, maxBytes);
    if (
      data.byteLength === 0 ||
      data.byteLength > maxBytes ||
      !hasImageSignature(data, mediaType)
    ) {
      throw new ImagegenError(
        "A source image is invalid or too large for the Kepos bridge.",
      );
    }
    sourceUrls.push(encodeImageDataUrl(data, mediaType));
  }
  if (signal?.aborted) {
    throw new ImagegenError("The image request was cancelled.");
  }
  return sourceUrls;
}

export async function readBridgeUrl(
  path: string,
  fs: FileOperations = nodeFileOperations,
): Promise<string> {
  try {
    const parsed: unknown = JSON.parse(await fs.readText(path));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return DEFAULT_BRIDGE_URL;
    }
    return validOrDefault((parsed as { bridgeUrl?: unknown }).bridgeUrl);
  } catch {
    return DEFAULT_BRIDGE_URL;
  }
}

export async function writeBridgeUrl(
  path: string,
  bridgeUrl: string,
  fs: FileOperations = nodeFileOperations,
): Promise<void> {
  await fs.mkdir(resolve(path, ".."));
  await fs.writeText(
    path,
    `${JSON.stringify({ bridgeUrl: normalizeBridgeUrl(bridgeUrl) }, null, 2)}\n`,
  );
}

function mediaTypeForPath(path: string): ImageMediaType {
  const extension = extname(path).toLowerCase();
  const mediaType =
    extension === ".png"
      ? "image/png"
      : extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : extension === ".gif"
          ? "image/gif"
          : extension === ".webp"
            ? "image/webp"
            : undefined;
  if (!isSupportedMediaType(mediaType)) {
    throw new ImagegenError(
      "Source images must be PNG, JPEG, GIF, or WebP files.",
    );
  }
  return mediaType;
}

function hasImageSignature(
  data: Uint8Array,
  mediaType: ImageMediaType,
): boolean {
  if (mediaType === "image/png") {
    return (
      data.length >= 8 &&
      data[0] === 137 &&
      data[1] === 80 &&
      data[2] === 78 &&
      data[3] === 71 &&
      data[4] === 13 &&
      data[5] === 10 &&
      data[6] === 26 &&
      data[7] === 10
    );
  }
  if (mediaType === "image/jpeg") {
    return (
      data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255
    );
  }
  if (mediaType === "image/gif") {
    const header = new TextDecoder().decode(data.slice(0, 6));
    return header === "GIF87a" || header === "GIF89a";
  }
  return (
    data.length >= 12 &&
    new TextDecoder().decode(data.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(data.slice(8, 12)) === "WEBP"
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

function safePiError(error: unknown): Error {
  if (error instanceof ImagegenError) {
    return error;
  }
  return new ImagegenError(
    "Unable to process the image request in Pi's current working directory.",
  );
}

function toBase64(data: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let start = 0; start < data.length; start += chunkSize) {
    binary += String.fromCharCode(...data.subarray(start, start + chunkSize));
  }
  return btoa(binary);
}
