import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerSubagent, type ExecCheck, type SpawnProcess } from "./index.ts";

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

type SpawnCall = { command: string; args: string[]; cwd?: string; env?: Record<string, string> };
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
	const spawn = ((command: string, args: string[], options: { cwd?: string; env?: Record<string, string> }) => {
		const call = { command, args: [...args], cwd: options.cwd, env: options.env };
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

function registered(
	spawn: SpawnProcess,
	execCheck?: ExecCheck,
): { subagent: Tool; checkDeps: Tool | undefined } {
	const tools: Tool[] = [];
	registerSubagent(
		{
			on() {},
			registerTool(definition: unknown) {
				tools.push(definition as Tool);
			},
		} as unknown as ExtensionAPI,
		spawn,
		execCheck,
	);
	const subagent = tools.find((t) => t.name === "subagent");
	const checkDeps = tools.find((t) => t.name === "check-workflow-deps");
	assert.ok(subagent);
	return { subagent: subagent!, checkDeps };
}

function execute(tool: Tool, params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
	return tool.execute("call-1", params, signal, undefined, { cwd: process.cwd(), hasUI: false });
}

function fakeExecCheck(
	behavior: (command: string, args: string[]) => { stdout?: string; stderr?: string; exitCode?: number },
): ExecCheck {
	return async (command: string, args: string[]) => {
		const b = behavior(command, args);
		return { stdout: b.stdout ?? "", stderr: b.stderr ?? "", exitCode: b.exitCode ?? 0 };
	};
}

describe("subagent tool", () => {
	it("registers both tools and requires exactly one invocation mode", async () => {
		const fake = fakeSpawn();
		const { subagent: tool } = registered(fake.spawn);
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
		const { subagent: tool } = registered(fakeSpawn().spawn);
		const result = await execute(tool, { agent: "missing", task: "work", agentScope: "project" });
		assert.equal(result.isError, true);
		assert.match(text(result), /Unknown agent: "missing"/);
		assert.match(text(result), /feature-implementer/);
	});

	it("rejects more than eight parallel tasks", async () => {
		const fake = fakeSpawn();
		const { subagent: tool } = registered(fake.spawn);
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
		const { subagent: tool } = registered(fake.spawn);
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

	it("forwards cwd, model selector, and env to spawned processes", async () => {
		const fake = fakeSpawn();
		const { subagent: tool } = registered(fake.spawn);
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
		assert.equal(fake.calls[0].env?.PI_FFF_MODE, "override");
	});

	it("surfaces non-zero exits, spawn errors, and missing final output", async () => {
		for (const [behavior, expected] of [
			[{ stderr: "child exploded", code: 2 }, /child exploded/],
			[{ error: new Error("ENOENT") }, /Failed to start subagent: ENOENT/],
			[{ code: 0 }, /No final assistant output/],
		] as Array<[SpawnBehavior, RegExp]>) {
			const { subagent: tool } = registered(fakeSpawn(() => behavior).spawn);
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
		const { subagent: tool } = registered(fake.spawn);
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

describe("check-workflow-deps tool", () => {
	const savedEnv = process.env.PI_FFF_MODE;

	afterEach(() => {
		if (savedEnv === undefined) {
			delete process.env.PI_FFF_MODE;
		} else {
			process.env.PI_FFF_MODE = savedEnv;
		}
	});

	it("passes when FFF override mode and Cymbal are available", async () => {
		process.env.PI_FFF_MODE = "override";
		const execCheck = fakeExecCheck((cmd, args) => {
			if (cmd === "find") return { stdout: "fff-find 2.0.0" };
			if (cmd === "grep") return { stdout: "fff-grep 2.0.0" };
			if (cmd === "cymbal") return { stdout: "cymbal v0.14.0" };
			return {};
		});
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck);
		assert.ok(checkDeps);
		const result = await execute(checkDeps, {});
		assert.equal(result.isError, false);
		assert.match(text(result), /✓ PI_FFF_MODE=override/);
		assert.match(text(result), /✓ FFF find: fff-find 2.0.0/);
		assert.match(text(result), /✓ FFF grep: fff-grep 2.0.0/);
		assert.match(text(result), /✓ Cymbal: cymbal v0.14.0/);
	});

	it("fails when PI_FFF_MODE is not override", async () => {
		delete process.env.PI_FFF_MODE;
		const execCheck = fakeExecCheck((cmd, args) => {
			if (cmd === "find") return { stdout: "fff-find 2.0.0" };
			if (cmd === "grep") return { stdout: "fff-grep 2.0.0" };
			if (cmd === "cymbal") return { stdout: "cymbal v0.14.0" };
			return {};
		});
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck);
		assert.ok(checkDeps);
		const result = await execute(checkDeps, {});
		assert.equal(result.isError, true);
		assert.match(text(result), /PI_FFF_MODE is not set/);
		assert.match(text(result), /✓ FFF find/);
		assert.match(text(result), /✓ Cymbal/);
	});

	it("fails when find is not FFF", async () => {
		process.env.PI_FFF_MODE = "override";
		const execCheck = fakeExecCheck((cmd, args) => {
			if (cmd === "find") return { stdout: "", exitCode: 1 };
			if (cmd === "grep") return { stdout: "fff-grep 2.0.0" };
			if (cmd === "cymbal") return { stdout: "cymbal v0.14.0" };
			return {};
		});
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck);
		assert.ok(checkDeps);
		const result = await execute(checkDeps, {});
		assert.equal(result.isError, true);
		assert.match(text(result), /'find' is not FFF/);
		assert.match(text(result), /✓ FFF grep/);
		assert.match(text(result), /✓ Cymbal/);
	});

	it("fails when grep is not FFF", async () => {
		process.env.PI_FFF_MODE = "override";
		const execCheck = fakeExecCheck((cmd, args) => {
			if (cmd === "find") return { stdout: "fff-find 2.0.0" };
			if (cmd === "grep") return { stdout: "", exitCode: 1 };
			if (cmd === "cymbal") return { stdout: "cymbal v0.14.0" };
			return {};
		});
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck);
		assert.ok(checkDeps);
		const result = await execute(checkDeps, {});
		assert.equal(result.isError, true);
		assert.match(text(result), /✓ FFF find/);
		assert.match(text(result), /'grep' is not FFF/);
		assert.match(text(result), /✓ Cymbal/);
	});

	it("fails when cymbal command fails", async () => {
		process.env.PI_FFF_MODE = "override";
		const execCheck = fakeExecCheck((cmd, args) => {
			if (cmd === "find") return { stdout: "fff-find 2.0.0" };
			if (cmd === "grep") return { stdout: "fff-grep 2.0.0" };
			if (cmd === "cymbal") return { stdout: "", stderr: "command not found", exitCode: 127 };
			return {};
		});
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck);
		assert.ok(checkDeps);
		const result = await execute(checkDeps, {});
		assert.equal(result.isError, true);
		assert.match(text(result), /✓ FFF find/);
		assert.match(text(result), /✓ FFF grep/);
		assert.match(text(result), /Cymbal not found/);
	});

	it("reports installation guidance for missing FFF tools and Cymbal", async () => {
		delete process.env.PI_FFF_MODE;
		const execCheck = fakeExecCheck(() => ({ stdout: "", exitCode: 127 }));
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck);
		assert.ok(checkDeps);
		const result = await execute(checkDeps, {});
		assert.equal(result.isError, true);
		assert.match(text(result), /PI_FFF_MODE is not set/);
		assert.match(text(result), /'find' is not FFF/);
		assert.match(text(result), /'grep' is not FFF/);
		assert.match(text(result), /Cymbal not found/);
		assert.match(text(result), /github.com/);
		assert.match(text(result), /npm install/);
	});
});
