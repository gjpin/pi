import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerSubagent, type SpawnProcess } from "./index.ts";

type ToolResult = {
	content: Array<{ type: string; text: string }>;
	details?: { results?: Array<Record<string, unknown>> };
	isError?: boolean;
};

type Tool = {
	name: string;
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: { cwd: string; hasUI: boolean },
	) => Promise<ToolResult>;
};

type SpawnCall = { command: string; args: string[]; cwd?: string };
type SpawnBehavior = { output?: string; stderr?: string; code?: number; delay?: number; error?: Error };

const pendingTimers = new Set<NodeJS.Timeout>();

afterEach(() => {
	for (const timer of pendingTimers) clearTimeout(timer);
	pendingTimers.clear();
});

function text(result: ToolResult): string {
	return result.content.find((part) => part.type === "text")?.text ?? "";
}

function fakeSpawn(
	behavior: (call: SpawnCall) => SpawnBehavior = () => ({ output: "done" }),
): { spawn: SpawnProcess; calls: SpawnCall[]; children: Array<EventEmitter & { killed: boolean }> } {
	const calls: SpawnCall[] = [];
	const children: Array<EventEmitter & { killed: boolean }> = [];
	const spawn = ((command: string, args: string[], options: { cwd?: string }) => {
		const call = { command, args: [...args], cwd: options.cwd };
		calls.push(call);
		const config = behavior(call);
		const child = new EventEmitter() as EventEmitter & {
			stdout: PassThrough;
			stderr: PassThrough;
			killed: boolean;
			kill: (signal?: string) => boolean;
		};
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.killed = false;
		child.kill = () => {
			child.killed = true;
			queueMicrotask(() => child.emit("close", 143));
			return true;
		};
		children.push(child);

		const timer = setTimeout(() => {
			pendingTimers.delete(timer);
			if (config.error) {
				child.emit("error", config.error);
				return;
			}
			if (config.stderr) child.stderr.write(config.stderr);
			if (config.output !== undefined) {
				child.stdout.write(
					`${JSON.stringify({
						type: "message_end",
						message: {
							role: "assistant",
							content: [{ type: "text", text: config.output }],
							stopReason: "end",
						},
					})}\n`,
				);
			}
			child.emit("close", config.code ?? 0);
		}, config.delay ?? 0);
		pendingTimers.add(timer);
		return child;
	}) as unknown as SpawnProcess;
	return { spawn, calls, children };
}

function registered(spawn: SpawnProcess): Tool {
	let tool: Tool | undefined;
	registerSubagent(
		{
			on() {},
			registerTool(definition: unknown) {
				tool = definition as Tool;
			},
		} as unknown as ExtensionAPI,
		spawn,
	);
	assert.ok(tool);
	assert.equal(tool.name, "subagent");
	return tool;
}

function execute(tool: Tool, params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
	return tool.execute("call-1", params, signal, undefined, { cwd: process.cwd(), hasUI: false });
}

describe("subagent tool", () => {
	it("registers one tool and requires exactly one invocation mode", async () => {
		const fake = fakeSpawn();
		const tool = registered(fake.spawn);
		assert.match(text(await execute(tool, { agentScope: "project" })), /exactly one mode/);
		assert.match(
			text(
				await execute(tool, {
					agent: "feature-implementer",
					task: "one",
					tasks: [{ agent: "feature-implementer", task: "two" }],
					agentScope: "project",
				}),
			),
			/exactly one mode/,
		);
		assert.equal(fake.calls.length, 0);
	});

	it("lists available agents for an unknown name", async () => {
		const tool = registered(fakeSpawn().spawn);
		const result = await execute(tool, { agent: "missing", task: "work", agentScope: "project" });
		assert.equal(result.isError, true);
		assert.match(text(result), /Unknown agent: "missing"/);
		assert.match(text(result), /feature-implementer/);
	});

	it("rejects more than eight parallel tasks", async () => {
		const fake = fakeSpawn();
		const tool = registered(fake.spawn);
		const tasks = Array.from({ length: 9 }, (_, index) => ({
			agent: "feature-implementer",
			task: `T${index + 1}`,
		}));
		assert.match(text(await execute(tool, { tasks, agentScope: "project" })), /Max is 8/);
		assert.equal(fake.calls.length, 0);
	});

	it("preserves parallel input order despite completion order", async () => {
		const fake = fakeSpawn((call) => {
			const task = call.args.at(-1);
			return task?.includes("slow") ? { output: "first", delay: 20 } : { output: "second", delay: 0 };
		});
		const tool = registered(fake.spawn);
		const result = await execute(tool, {
			tasks: [
				{ agent: "feature-implementer", task: "slow" },
				{ agent: "feature-implementer", task: "fast" },
			],
			agentScope: "project",
		});
		assert.ok(text(result).indexOf("first") < text(result).indexOf("second"));
		assert.equal(result.isError, false);
	});

	it("forwards each cwd and the exact frontmatter model selector", async () => {
		const fake = fakeSpawn();
		const tool = registered(fake.spawn);
		await execute(tool, {
			agent: "feature-reviewer",
			task: "review",
			cwd: "/tmp/integration-worktree",
			agentScope: "project",
		});

		assert.equal(fake.calls[0].cwd, "/tmp/integration-worktree");
		const modelIndex = fake.calls[0].args.indexOf("--model");
		assert.equal(fake.calls[0].args[modelIndex + 1], "openai-codex/gpt-5.6-luna:xhigh");
		assert.equal(fake.calls[0].args.includes("--no-session"), true);
	});

	it("surfaces non-zero exits, spawn errors, and missing final output", async () => {
		for (const [behavior, expected] of [
			[{ stderr: "child exploded", code: 2 }, /child exploded/],
			[{ error: new Error("ENOENT") }, /Failed to start subagent: ENOENT/],
			[{ code: 0 }, /No final assistant output/],
		] as Array<[SpawnBehavior, RegExp]>) {
			const tool = registered(fakeSpawn(() => behavior).spawn);
			const result = await execute(tool, {
				agent: "feature-implementer",
				task: "work",
				agentScope: "project",
			});
			assert.equal(result.isError, true);
			assert.match(text(result), expected);
		}
	});

	it("terminates the child when aborted", async () => {
		const fake = fakeSpawn(() => ({ output: "too late", delay: 1_000 }));
		const tool = registered(fake.spawn);
		const controller = new AbortController();
		const running = execute(
			tool,
			{ agent: "feature-implementer", task: "work", agentScope: "project" },
			controller.signal,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.abort();
		await assert.rejects(running, /Subagent was aborted/);
		assert.equal(fake.children[0].killed, true);
	});
});
