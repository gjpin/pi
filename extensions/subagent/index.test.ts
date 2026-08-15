import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerSubagent, type ExecCheck, type SpawnProcess, CYMNAL_COMMANDS } from "./index.ts";

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

type MockToolEntry = {
	name: string;
	sourceInfo: { source: string; path?: string };
};

function mockAllTools(overrides?: Partial<Record<string, "builtin" | "extension">>): MockToolEntry[] {
	const defaults: Record<string, "builtin" | "extension"> = {
		read: "builtin",
		bash: "builtin",
		write: "builtin",
		edit: "builtin",
		ls: "builtin",
		find: "builtin",
		grep: "builtin",
		subagent: "extension",
		"check-workflow-deps": "extension",
		cymbal: "extension",
	};
	const final: Record<string, "builtin" | "extension"> = { ...defaults, ...overrides };
	return Object.entries(final).map(([name, source]) => ({
		name,
		sourceInfo: {
			source,
			path: source === "extension" ? `pi-fff:${name}` : `<builtin:${name}>`,
		},
	}));
}

type ExecCall = { command: string; args: string[] };

function registered(
	spawn: SpawnProcess,
	execCheck?: ExecCheck,
	allTools: MockToolEntry[] = mockAllTools(),
): {
	subagent: Tool;
	checkDeps: Tool | undefined;
	cymbal: Tool | undefined;
	execCalls: ExecCall[];
} {
	const tools: Tool[] = [];
	const execCalls: ExecCall[] = [];
	const mockPi = {
		on() {},
		registerTool(definition: unknown) {
			tools.push(definition as Tool);
		},
		getAllTools() {
			return allTools;
		},
		exec(command: string, args: string[], options?: { signal?: AbortSignal }) {
			execCalls.push({ command, args: [...args] });
			if (options?.signal?.aborted) {
				return Promise.reject(new Error("Aborted"));
			}
			if (execCheck) {
				return execCheck(command, args).then((r) => ({
					stdout: r.stdout,
					stderr: r.stderr,
					code: r.exitCode,
					killed: false,
				}));
			}
			return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false });
		},
	} as unknown as ExtensionAPI;
	registerSubagent(mockPi, spawn, execCheck);
	const subagent = tools.find((t) => t.name === "subagent");
	const checkDeps = tools.find((t) => t.name === "check-workflow-deps");
	const cymbal = tools.find((t) => t.name === "cymbal");
	assert.ok(subagent);
	return { subagent: subagent!, checkDeps, cymbal, execCalls };
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

	it("bounded explorer final output to ~800 words", async () => {
		// Generate output well over 800 words
		const longOutput = Array.from({ length: 200 }, (_, i) => `word_${i} `.repeat(10)).join("");
		const fake = fakeSpawn(() => ({ output: longOutput }));
		const { subagent: tool } = registered(fake.spawn);
		const result = await execute(tool, {
			agent: "codebase-explorer",
			task: "explore",
			agentScope: "project",
			cwd: "/tmp",
		});
		const output = text(result);
		const wordCount = output.split(/\s+/).filter(Boolean).length;
		assert.ok(wordCount <= 820, `output too long: ${wordCount} words`);
		assert.match(output, /\[Output truncated to ~800 words/);
	});

	it("does not truncate non-explorer agent output", async () => {
		const longOutput = Array.from({ length: 200 }, (_, i) => `word_${i} `.repeat(10)).join("");
		const fake = fakeSpawn(() => ({ output: longOutput }));
		const { subagent: tool } = registered(fake.spawn);
		const result = await execute(tool, {
			agent: "feature-implementer",
			task: "implement",
			agentScope: "project",
		});
		const output = text(result);
		const wordCount = output.split(/\s+/).filter(Boolean).length;
		assert.ok(wordCount >= 1000, `unexpectedly truncated: ${wordCount} words`);
		assert.doesNotMatch(output, /\[Output truncated/);
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

	it("passes when PI_FFF_MODE=override, find/grep are FFF extensions, and cymbal is available", async () => {
		process.env.PI_FFF_MODE = "override";
		const execCheck = fakeExecCheck((cmd, args) => {
			if (cmd === "cymbal") return { stdout: "cymbal v0.14.0" };
			return {};
		});
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck, mockAllTools({ find: "extension", grep: "extension" }));
		assert.ok(checkDeps);
		const result = await execute(checkDeps, {});
		assert.equal(result.isError, false);
		assert.match(text(result), /✓ PI_FFF_MODE=override/);
		assert.match(text(result), /✓ FFF find override active/);
		assert.match(text(result), /✓ FFF grep override active/);
		assert.match(text(result), /✓ Cymbal: cymbal v0.14.0/);
	});

	it("fails when PI_FFF_MODE is not override", async () => {
		delete process.env.PI_FFF_MODE;
		const execCheck = fakeExecCheck((cmd, args) => {
			if (cmd === "cymbal") return { stdout: "cymbal v0.14.0" };
			return {};
		});
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck, mockAllTools({ find: "extension", grep: "extension" }));
		assert.ok(checkDeps);
		const result = await execute(checkDeps, {});
		assert.equal(result.isError, true);
		assert.match(text(result), /PI_FFF_MODE is not set/);
		assert.match(text(result), /✓ FFF find override active/);
		assert.match(text(result), /✓ Cymbal/);
	});

	it("fails when find is not an FFF override (builtin source)", async () => {
		process.env.PI_FFF_MODE = "override";
		const execCheck = fakeExecCheck((cmd, args) => {
			if (cmd === "cymbal") return { stdout: "cymbal v0.14.0" };
			return {};
		});
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck, mockAllTools({ find: "builtin", grep: "extension" }));
		assert.ok(checkDeps);
		const result = await execute(checkDeps, {});
		assert.equal(result.isError, true);
		assert.match(text(result), /'find' is not an FFF override/);
		assert.match(text(result), /✓ FFF grep override active/);
		assert.match(text(result), /✓ Cymbal/);
	});

	it("fails when grep is not an FFF override (builtin source)", async () => {
		process.env.PI_FFF_MODE = "override";
		const execCheck = fakeExecCheck((cmd, args) => {
			if (cmd === "cymbal") return { stdout: "cymbal v0.14.0" };
			return {};
		});
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck, mockAllTools({ find: "extension", grep: "builtin" }));
		assert.ok(checkDeps);
		const result = await execute(checkDeps, {});
		assert.equal(result.isError, true);
		assert.match(text(result), /✓ FFF find override active/);
		assert.match(text(result), /'grep' is not an FFF override/);
		assert.match(text(result), /✓ Cymbal/);
	});

	it("fails when cymbal command fails", async () => {
		process.env.PI_FFF_MODE = "override";
		const execCheck = fakeExecCheck((cmd, args) => {
			if (cmd === "cymbal") return { stdout: "", stderr: "command not found", exitCode: 127 };
			return {};
		});
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck, mockAllTools({ find: "extension", grep: "extension" }));
		assert.ok(checkDeps);
		const result = await execute(checkDeps, {});
		assert.equal(result.isError, true);
		assert.match(text(result), /✓ FFF find override active/);
		assert.match(text(result), /✓ FFF grep override active/);
		assert.match(text(result), /Cymbal not found/);
	});

	it("reports installation guidance for missing FFF tools and Cymbal", async () => {
		delete process.env.PI_FFF_MODE;
		const execCheck = fakeExecCheck((cmd, args) => {
			if (cmd === "cymbal") return { stdout: "", stderr: "command not found", exitCode: 127 };
			return {};
		});
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck, mockAllTools({ find: "builtin", grep: "builtin" }));
		assert.ok(checkDeps);
		const result = await execute(checkDeps, {});
		assert.equal(result.isError, true);
		assert.match(text(result), /PI_FFF_MODE is not set/);
		assert.match(text(result), /'find' is not an FFF override/);
		assert.match(text(result), /'grep' is not an FFF override/);
		assert.match(text(result), /Cymbal not found/);
		assert.match(text(result), /github.com/);
		assert.match(text(result), /npm install/);
	});

	it("invokes cymbal version via execCheck", async () => {
		process.env.PI_FFF_MODE = "override";
		const execCalls: Array<{ command: string; args: string[] }> = [];
		const execCheck = fakeExecCheck((cmd, args) => {
			execCalls.push({ command: cmd, args });
			if (cmd === "cymbal") return { stdout: "cymbal v0.14.0" };
			return {};
		});
		const { checkDeps } = registered(fakeSpawn().spawn, execCheck, mockAllTools({ find: "extension", grep: "extension" }));
		assert.ok(checkDeps);
		await execute(checkDeps, {});
		assert.equal(execCalls.length, 1);
		assert.equal(execCalls[0].command, "cymbal");
		assert.deepEqual(execCalls[0].args, ["version"]);
	});
});

describe("cymbal tool", () => {
	it("registers the cymbal tool", async () => {
		const { cymbal } = registered(fakeSpawn().spawn);
		assert.ok(cymbal, "cymbal tool must be registered");
	});

	it("accepts allowed cymbal commands", async () => {
		const execCheck = fakeExecCheck(() => ({ stdout: "ok" }));
		const { cymbal } = registered(fakeSpawn().spawn, execCheck);
		assert.ok(cymbal);
		for (const cmd of CYMNAL_COMMANDS) {
			const result = await execute(cymbal, { command: cmd });
			assert.equal(result.isError ?? false, false, `${cmd} should not error`);
			assert.match(text(result), /ok/);
		}
	});

	it("rejects invalid cymbal commands", async () => {
		const execCheck = fakeExecCheck(() => ({ stdout: "should not run" }));
		const { cymbal } = registered(fakeSpawn().spawn, execCheck);
		assert.ok(cymbal);
		const result = await execute(cymbal, { command: "install" });
		assert.equal(result.isError, true);
		assert.match(text(result), /Invalid cymbal command/);
	});

	it("rejects mutating cymbal commands", async () => {
		const { cymbal } = registered(fakeSpawn().spawn);
		assert.ok(cymbal);
		for (const bad of ["index", "hook", "completion", "help"]) {
			const result = await execute(cymbal, { command: bad });
			assert.equal(result.isError, true, `${bad} should be rejected`);
		}
	});

	it("reports non-zero exit as tool error", async () => {
		const execCheck = fakeExecCheck(() => ({ stdout: "", stderr: "not found", exitCode: 1 }));
		const { cymbal } = registered(fakeSpawn().spawn, execCheck);
		assert.ok(cymbal);
		const result = await execute(cymbal, { command: "show", args: ["unknown"] });
		assert.equal(result.isError, true);
		assert.match(text(result), /not found/);
	});

	it("passes command arguments through", async () => {
		const execCheck = fakeExecCheck((cmd, args) => {
			assert.equal(cmd, "cymbal");
			return { stdout: `ran ${args.join(" ")}` };
		});
		const { cymbal, execCalls } = registered(fakeSpawn().spawn, execCheck);
		assert.ok(cymbal);
		await execute(cymbal, { command: "show", args: ["src/main.ts"] });
		assert.equal(execCalls.length, 1);
		assert.deepEqual(execCalls[0].args, ["show", "src/main.ts"]);
	});

	it("propagates cancellation", async () => {
		const execCheck = fakeExecCheck(() => ({ stdout: "should not complete" }));
		const { cymbal } = registered(fakeSpawn().spawn, execCheck);
		assert.ok(cymbal);
		const controller = new AbortController();
		controller.abort();
		const result = await execute(cymbal, { command: "version" }, controller.signal);
		// Tool catches the abort error from pi.exec and reports isError
		assert.equal(result.isError, true, "aborted cymbal should be an error");
	});

	it("truncates oversized output at 50KB cap", async () => {
		const largeOutput = "x".repeat(60 * 1024);
		const execCheck = fakeExecCheck(() => ({ stdout: largeOutput }));
		const { cymbal } = registered(fakeSpawn().spawn, execCheck);
		assert.ok(cymbal);
		const result = await execute(cymbal, { command: "structure" });
		assert.ok(Buffer.byteLength(text(result), "utf8") < 55 * 1024);
		assert.match(text(result), /Output truncated/);
	});
});