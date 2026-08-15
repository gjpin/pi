import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerCymbal, CYMBAL_COMMANDS } from "./index.ts";

type ToolResult = {
	content: Array<{ type: string; text: string }>;
	details?: Record<string, unknown>;
	isError?: boolean;
};

type Tool = {
	name: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: { cwd: string; hasUI: boolean },
	) => Promise<ToolResult>;
};

type ExecCall = { command: string; args: string[] };
type ExecBehavior = (command: string, args: string[]) => { stdout?: string; stderr?: string; code?: number };

function text(result: ToolResult): string {
	return result.content.find((part) => part.type === "text")?.text ?? "";
}

function registered(
	execBehavior: ExecBehavior = () => ({ stdout: "" }),
): { cymbal: Tool; execCalls: ExecCall[] } {
	const tools: Tool[] = [];
	const execCalls: ExecCall[] = [];
	const mockPi = {
		on() {},
		registerTool(definition: unknown) {
			tools.push(definition as Tool);
		},
		exec(command: string, args: string[], options?: { signal?: AbortSignal }) {
			execCalls.push({ command, args: [...args] });
			if (options?.signal?.aborted) {
				return Promise.reject(new Error("Aborted"));
			}
			const b = execBehavior(command, args);
			return Promise.resolve({ stdout: b.stdout ?? "", stderr: b.stderr ?? "", code: b.code ?? 0, killed: false });
		},
	} as unknown as ExtensionAPI;
	registerCymbal(mockPi);
	const cymbal = tools.find((t) => t.name === "cymbal");
	assert.ok(cymbal, "cymbal tool must be registered");
	assert.equal(tools.length, 1, "cymbal extension registers only the cymbal tool");
	return { cymbal: cymbal!, execCalls };
}

function execute(tool: Tool, params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
	return tool.execute("call-1", params, signal, undefined, { cwd: process.cwd(), hasUI: false });
}

describe("cymbal extension", () => {
	it("registers only the cymbal tool with operating guidance", async () => {
		const { cymbal } = registered();
		assert.ok(cymbal.promptSnippet, "promptSnippet must guide tool selection");
		assert.ok(Array.isArray(cymbal.promptGuidelines) && cymbal.promptGuidelines.length > 0, "promptGuidelines required");
		const guidance = cymbal.promptGuidelines!.join(" ");
		// Investigation loop + command selection
		assert.match(guidance, /search/);
		assert.match(guidance, /investigate/);
		// Pivot and stop rules
		assert.match(guidance, /pivot/);
		assert.match(guidance, /Do not/);
		// Safety restrictions
		assert.match(guidance, /read-only/);
		assert.match(guidance, /mutating/);
	});

	it("accepts allowed cymbal commands", async () => {
		const { cymbal } = registered(() => ({ stdout: "ok" }));
		for (const cmd of CYMBAL_COMMANDS) {
			const result = await execute(cymbal, { command: cmd });
			assert.equal(result.isError, undefined, `${cmd} must not set isError`);
			assert.match(text(result), /ok/);
		}
	});

	it("throws for invalid cymbal commands (not isError)", async () => {
		const { cymbal } = registered(() => ({ stdout: "should not run" }));
		await assert.rejects(
			() => execute(cymbal, { command: "install" }),
			/Invalid cymbal command/,
		);
	});

	it("throws for known-bad mutating commands", async () => {
		const { cymbal } = registered();
		for (const bad of ["index", "hook", "completion", "help"]) {
			await assert.rejects(
				() => execute(cymbal, { command: bad }),
				/Invalid cymbal command/,
				`${bad} should throw`,
			);
		}
	});

	it("throws for non-zero exit with stderr preserved", async () => {
		const { cymbal } = registered(() => ({
			stdout: "",
			stderr: "not found\nUsage: cymbal show <path>",
			code: 1,
		}));
		await assert.rejects(
			() => execute(cymbal, { command: "show", args: ["unknown"] }),
			/not found/,
		);
	});

	it("passes command arguments through", async () => {
		const { cymbal, execCalls } = registered((cmd, args) => {
			assert.equal(cmd, "cymbal");
			return { stdout: `ran ${args.join(" ")}` };
		});
		await execute(cymbal, { command: "show", args: ["src/main.ts"] });
		assert.equal(execCalls.length, 1);
		assert.deepEqual(execCalls[0].args, ["show", "src/main.ts"]);
	});

	it("throws on cancellation (aborted signal)", async () => {
		const { cymbal } = registered(() => ({ stdout: "should not complete" }));
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(
			() => execute(cymbal, { command: "version" }, controller.signal),
			/cymbal execution aborted/,
		);
	});

	it("truncates oversized output at 50KB cap and returns full output in details", async () => {
		const largeOutput = "x".repeat(60 * 1024);
		const { cymbal } = registered(() => ({ stdout: largeOutput }));
		const result = await execute(cymbal, { command: "structure" });
		assert.ok(Buffer.byteLength(text(result), "utf8") < 55 * 1024);
		assert.match(text(result), /Output truncated/);
		// Full untruncated output preserved in details
		assert.ok(result.details, "details must exist for truncated output");
		const fullOutput = (result.details as Record<string, unknown>).fullOutput as string | undefined;
		assert.ok(fullOutput, "details.fullOutput must exist");
		assert.equal(fullOutput, largeOutput, "full output must be untruncated");
	});
});
