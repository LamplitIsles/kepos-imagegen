import {
  DEFAULT_BRIDGE_URL,
  MAX_BRIDGE_JSON_BYTES,
  remainingSourceBytes,
  type RequestImageOptions,
} from "@lamplitisles/imagegen-core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_FILE_NAME,
  SETTINGS_COMMAND,
  TOOL_NAME,
  installPiImagegen,
  readBridgeUrl,
  writeBridgeUrl,
  type FileOperations,
} from "../src/index.js";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);

function fakeFileOperations(
  options: { outside?: boolean; data?: Uint8Array } = {},
): FileOperations & {
  limits: number[];
  writes: Array<{ path: string; value: string }>;
  text: Map<string, string>;
} {
  const text = new Map<string, string>();
  const limits: number[] = [];
  const writes: Array<{ path: string; value: string }> = [];
  return {
    limits,
    writes,
    text,
    async realpath(path) {
      if (path === "/work") return "/work-real";
      if (options.outside && path.endsWith("escape.png"))
        return "/private/escape.png";
      return path.replace("/work/", "/work-real/");
    },
    async readImage(_path, maxBytes) {
      limits.push(maxBytes);
      return options.data ?? png;
    },
    async readText(path) {
      const value = text.get(path);
      if (value === undefined) throw new Error("missing");
      return value;
    },
    async writeText(path, value) {
      writes.push({ path, value });
      text.set(path, value);
    },
    async mkdir() {},
  };
}

function install(options: Parameters<typeof fakeFileOperations>[0] = {}) {
  let tool: any;
  let command: any;
  const fs = fakeFileOperations(options);
  const requests: RequestImageOptions[] = [];
  installPiImagegen(
    {
      registerTool(definition: unknown) {
        tool = definition;
      },
      registerCommand(name: string, definition: unknown) {
        command = { name, definition };
      },
    } as any,
    {
      fs,
      getAgentDirectory: () => "/agent",
      request: async (request) => {
        requests.push(request);
        return { data: png, mediaType: "image/png" };
      },
    },
  );
  return { tool, command, fs, requests };
}

describe("Pi image adapter", () => {
  it("registers exactly one sequential relative-path tool and one settings command", () => {
    const { tool, command } = install();
    expect(tool.name).toBe(TOOL_NAME);
    expect(tool.executionMode).toBe("sequential");
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.description).toContain(
      "relative to Pi's current working directory",
    );
    expect(command.name).toBe(SETTINGS_COMMAND);
  });

  it("generates and edits safely, forwards cancellation, and returns a native image block", async () => {
    const { tool, fs, requests } = install();
    const controller = new AbortController();
    const context = { cwd: "/work" } as any;

    const generated = await tool.execute(
      "one",
      { prompt: "misty islands" },
      controller.signal,
      undefined,
      context,
    );
    expect(requests[0]).toMatchObject({
      prompt: "misty islands",
      baseUrl: DEFAULT_BRIDGE_URL,
      signal: controller.signal,
    });
    expect(requests[0]?.images).toBeUndefined();
    expect(generated).toEqual({
      content: [
        { type: "text", text: "Generated image." },
        { type: "image", data: "iVBORw0KGgoA", mimeType: "image/png" },
      ],
      details: { imageCount: 0 },
    });

    const edited = await tool.execute(
      "two",
      { prompt: "make it brighter", images: ["source.png"] },
      undefined,
      undefined,
      context,
    );
    expect(requests[1]).toMatchObject({
      prompt: "make it brighter",
      images: ["data:image/png;base64,iVBORw0KGgoA"],
    });
    expect(edited.details).toEqual({ imageCount: 1 });
    expect(fs.limits[0]).toBeGreaterThan(png.byteLength);
  });

  it("accepts five sources and returns path-free errors for confinement and input failures", async () => {
    const { tool, requests } = install();
    const context = { cwd: "/work" } as any;
    await tool.execute(
      "five",
      { prompt: "edit", images: ["1.png", "2.png", "3.png", "4.png", "5.png"] },
      undefined,
      undefined,
      context,
    );
    expect(requests[0]?.images).toHaveLength(5);
    await expect(
      tool.execute(
        "six",
        {
          prompt: "edit",
          images: ["1.png", "2.png", "3.png", "4.png", "5.png", "6.png"],
        },
        undefined,
        undefined,
        context,
      ),
    ).rejects.toThrow("between one and five");
    await expect(
      tool.execute(
        "absolute",
        { prompt: "edit", images: ["/etc/passwd"] },
        undefined,
        undefined,
        context,
      ),
    ).rejects.not.toThrow("/etc");

    const escaped = install({ outside: true });
    await expect(
      escaped.tool.execute(
        "escape",
        { prompt: "edit", images: ["escape.png"] },
        undefined,
        undefined,
        context,
      ),
    ).rejects.not.toThrow("/private");
    const invalid = install({
      data: new Uint8Array([137, 80, 78, 71, 0, 0, 0, 0]),
    });
    await expect(
      invalid.tool.execute(
        "bad",
        { prompt: "edit", images: ["source.png"] },
        undefined,
        undefined,
        context,
      ),
    ).rejects.toThrow("invalid or too large");
  });

  it("calculates a bounded read before touching an oversized bridge request", async () => {
    const { tool, fs } = install();
    await expect(
      tool.execute(
        "large",
        { prompt: "x".repeat(MAX_BRIDGE_JSON_BYTES), images: ["source.png"] },
        undefined,
        undefined,
        { cwd: "/work" } as any,
      ),
    ).rejects.toThrow("too large");
    expect(fs.limits).toEqual([]);
  });

  it("bounds production file reads to the remaining bridge budget", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kepos-imagegen-test-"));
    try {
      const source = join(directory, "source.png");
      const maxBytes = remainingSourceBytes("edit", [], "image/png");
      const data = new Uint8Array(maxBytes + 1);
      data.set(png);
      await writeFile(source, data);

      let tool: any;
      let requests = 0;
      installPiImagegen(
        {
          registerTool(definition: unknown) {
            tool = definition;
          },
          registerCommand() {},
        } as any,
        {
          getAgentDirectory: () => directory,
          request: async () => {
            requests += 1;
            return { data: png, mediaType: "image/png" as const };
          },
        },
      );

      await expect(
        tool.execute(
          "overflow",
          { prompt: "edit", images: ["source.png"] },
          undefined,
          undefined,
          { cwd: directory },
        ),
      ).rejects.toThrow("invalid or too large");
      expect(requests).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses only the global bridgeUrl config with invalid fallback and interactive settings", async () => {
    const fs = fakeFileOperations();
    const configPath = `/agent/${CONFIG_FILE_NAME}`;
    fs.text.set(
      configPath,
      JSON.stringify({ bridgeUrl: "https://bridge.example/" }),
    );
    await expect(readBridgeUrl(configPath, fs)).resolves.toBe(
      "https://bridge.example",
    );
    fs.text.set(
      configPath,
      JSON.stringify({ bridgeUrl: "https://bridge.example/path" }),
    );
    await expect(readBridgeUrl(configPath, fs)).resolves.toBe(
      DEFAULT_BRIDGE_URL,
    );
    await writeBridgeUrl(configPath, "https://bridge.example/", fs);
    expect(JSON.parse(fs.writes[0]?.value ?? "{}")).toEqual({
      bridgeUrl: "https://bridge.example",
    });

    const { command, fs: commandFs } = install();
    const notices: Array<{ text: string; type?: string | undefined }> = [];
    await command.definition.handler("", {
      hasUI: false,
      ui: {
        notify(text: string, type?: string) {
          notices.push({ text, type });
        },
      },
    });
    expect(notices[0]?.text).toContain("Interactive UI is required");

    await command.definition.handler("", {
      hasUI: true,
      ui: {
        async input() {
          return "https://saved.example/";
        },
        notify(text: string, type?: string) {
          notices.push({ text, type });
        },
      },
    });
    expect(JSON.parse(commandFs.writes[0]?.value ?? "{}")).toEqual({
      bridgeUrl: "https://saved.example",
    });
    expect(notices.at(-1)?.text).toContain("saved");
  });
});
