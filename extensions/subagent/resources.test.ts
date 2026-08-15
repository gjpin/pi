import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { discoverAgents } from "./agents.ts";
import {
	buildExtensionCatalog,
	buildSkillCatalog,
	localExtensionName,
	parseExtensionSelector,
	prevalidateAgents,
	registerSubagent,
	resolveExtensionSelectors,
	resolveSkillSelectors,
	type ExtensionCatalogEntry,
	type SkillCatalogEntry,
	type SpawnProcess,
} from "./index.ts";

type ToolResult = {
	content: Array<{ type: string; text: string }>;
	details?: Record<string, unknown>;
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
const tempDirs: string[] = [];

afterEach(async () => {
	for (const timer of pendingTimers) clearTimeout(timer);
	pendingTimers.clear();
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function text(result: ToolResult): string {
	return result.content.find((part) => part.type === "text")?.text ?? "";
}

function fakeSpawn(
	behavior: (call: SpawnCall) => SpawnBehavior = () => ({ output: "done" }),
): { spawn: SpawnProcess; calls: SpawnCall[] } {
	const calls: SpawnCall[] = [];
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
	return { spawn, calls };
}

function resourceFlags(args: string[]): { extensions: string[]; skills: string[] } {
	const extensions: string[] = [];
	const skills: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--extension") extensions.push(args[i + 1]);
		if (args[i] === "--skill") skills.push(args[i + 1]);
	}
	return { extensions, skills };
}

// ---------------------------------------------------------------------------
// Fixtures: parent-loaded tool provenance and extension/skill commands.
// ---------------------------------------------------------------------------

type ToolEntry = { name: string; sourceInfo: { source: string; path: string } };
type CommandEntry = { name: string; description?: string; source: string; sourceInfo: { source: string; path: string } };

const TOOLS: ToolEntry[] = [
	{ name: "read", sourceInfo: { source: "builtin", path: "<builtin:read>" } },
	{ name: "bash", sourceInfo: { source: "builtin", path: "<builtin:bash>" } },
	{ name: "write", sourceInfo: { source: "builtin", path: "<builtin:write>" } },
	{ name: "edit", sourceInfo: { source: "builtin", path: "<builtin:edit>" } },
	{ name: "ls", sourceInfo: { source: "builtin", path: "<builtin:ls>" } },
	{ name: "find", sourceInfo: { source: "extension", path: "node_modules/@ff-labs/pi-fff/src/index.ts" } },
	{ name: "grep", sourceInfo: { source: "extension", path: "node_modules/@ff-labs/pi-fff/src/index.ts" } },
	{ name: "cymbal", sourceInfo: { source: "extension", path: "extensions/cymbal/index.ts" } },
	{ name: "subagent", sourceInfo: { source: "extension", path: "extensions/subagent/index.ts" } },
	{ name: "check-workflow-deps", sourceInfo: { source: "extension", path: "extensions/subagent/index.ts" } },
	{ name: "exa_contents", sourceInfo: { source: "extension", path: "extensions/exa-search/index.ts" } },
	{ name: "exa_search", sourceInfo: { source: "extension", path: "extensions/exa-search/index.ts" } },
];

const COMMANDS: CommandEntry[] = [
	{
		name: "ponytail",
		description: "Apply the laziest solution",
		source: "extension",
		sourceInfo: { source: "extension", path: ".pi/agent/git/github.com/DietrichGebert/ponytail/pi-extension/index.ts" },
	},
	{
		name: "skill:ponytail",
		description: "Ponytail skill",
		source: "skill",
		sourceInfo: { source: "local", path: ".pi/agent/git/github.com/DietrichGebert/ponytail/skills/ponytail/SKILL.md" },
	},
	{
		name: "skill:ponytail-review",
		description: "Ponytail review skill",
		source: "skill",
		sourceInfo: { source: "local", path: ".pi/agent/git/github.com/DietrichGebert/ponytail/skills/ponytail-review/SKILL.md" },
	},
];

const FFF_PATH = "node_modules/@ff-labs/pi-fff/src/index.ts";
const CYMBAL_PATH = "extensions/cymbal/index.ts";
const SUBAGENT_PATH = "extensions/subagent/index.ts";
const PONYTAIL_EXT_PATH = ".pi/agent/git/github.com/DietrichGebert/ponytail/pi-extension/index.ts";
const PONYTAIL_SKILL_PATH = ".pi/agent/git/github.com/DietrichGebert/ponytail/skills/ponytail/SKILL.md";
const PONYTAIL_REVIEW_SKILL_PATH = ".pi/agent/git/github.com/DietrichGebert/ponytail/skills/ponytail-review/SKILL.md";

const EXTENSION_CATALOG = buildExtensionCatalog(mockPi());
const SKILL_CATALOG = buildSkillCatalog(mockPi());

function mockPi(tools: ToolEntry[] = TOOLS, commands: CommandEntry[] = COMMANDS): ExtensionAPI {
	return {
		on() {},
		getAllTools() {
			return tools;
		},
		getActiveTools() {
			return tools.map((t) => t.name);
		},
		getCommands() {
			return commands;
		},
		exec() {
			return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false });
		},
	} as unknown as ExtensionAPI;
}

function registered(
	spawn: SpawnProcess,
	tools: ToolEntry[] = TOOLS,
	commands: CommandEntry[] = COMMANDS,
): { subagent: Tool } {
	const toolsOut: Tool[] = [];
	const pi = {
		...mockPi(tools, commands),
		registerTool(definition: unknown) {
			toolsOut.push(definition as Tool);
		},
	} as unknown as ExtensionAPI;
	registerSubagent(pi, spawn);
	const subagent = toolsOut.find((t) => t.name === "subagent");
	assert.ok(subagent);
	return { subagent: subagent! };
}

function executeAt(tool: Tool, params: Record<string, unknown>, cwd: string): Promise<ToolResult> {
	return tool.execute("call-1", params, undefined, undefined, { cwd, hasUI: false });
}

async function project(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-subagent-resources-"));
	tempDirs.push(root);
	await mkdir(join(root, ".pi", "agents"), { recursive: true });
	return root;
}

function markdown(frontmatter: string, body = "Do the work."): string {
	return `---\n${frontmatter}\n---\n\n${body}\n`;
}

// ---------------------------------------------------------------------------
// Catalog building from parent-loaded provenance (AC2/AC7)
// ---------------------------------------------------------------------------

describe("extension catalog from parent-loaded provenance", () => {
	it("includes tool-provided extensions, deduped by shared provenance path", () => {
		const catalog = buildExtensionCatalog(mockPi());
		assert.equal(catalog.length, 5);
		assert.ok(catalog.some((e) => e.path === FFF_PATH), "FFF extension from find/grep provenance");
		assert.ok(catalog.some((e) => e.path === CYMBAL_PATH));
		assert.ok(catalog.some((e) => e.path === SUBAGENT_PATH));
		assert.ok(catalog.some((e) => e.path === "extensions/exa-search/index.ts"));
	});

	it("includes command-only extensions such as Ponytail", () => {
		const catalog = buildExtensionCatalog(mockPi());
		assert.ok(
			catalog.some((e) => e.path === PONYTAIL_EXT_PATH),
			"ponytail pi-extension has no tools, only commands, yet must be in the catalog",
		);
	});

	it("excludes builtin tools", () => {
		const catalog = buildExtensionCatalog(mockPi());
		for (const e of catalog) assert.notEqual(e.source, "builtin");
		assert.ok(!catalog.some((e) => e.path.includes("builtin")));
	});

	it("derives the unique local name of an extension entry", () => {
		assert.equal(localExtensionName("extensions/cymbal/index.ts"), "cymbal");
		assert.equal(localExtensionName("extensions/exa-search/index.ts"), "exa-search");
		assert.equal(localExtensionName("extensions/exa-search.ts"), "exa-search");
		assert.equal(localExtensionName(FFF_PATH), "src");
	});
});

describe("skill catalog from parent-loaded skill commands", () => {
	it("maps exact skill names to their SKILL.md paths", () => {
		const catalog = buildSkillCatalog(mockPi());
		assert.deepEqual(
			catalog.map((s) => [s.name, s.path]),
			[
				["ponytail", PONYTAIL_SKILL_PATH],
				["ponytail-review", PONYTAIL_REVIEW_SKILL_PATH],
			],
		);
	});
});

// ---------------------------------------------------------------------------
// Frontmatter parsing (AC1)
// ---------------------------------------------------------------------------

describe("agent resource frontmatter parsing", () => {
	it("parses YAML-array extensions and skills into agent configuration", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "worker.md"),
			markdown(
				[
					"name: worker",
					"description: Resource worker",
					"model: openai-codex/gpt-5.6-luna:xhigh",
					"tools: read, grep, find, ls, cymbal",
					"extensions:",
					'  - "@ff-labs/pi-fff:src"',
					"  - cymbal",
					"skills:",
					"  - ponytail",
				].join("\n"),
			),
		);
		const [agent] = discoverAgents(root, "project").agents;
		assert.equal(agent.name, "worker");
		assert.deepEqual(agent.extensions, ["@ff-labs/pi-fff:src", "cymbal"]);
		assert.deepEqual(agent.skills, ["ponytail"]);
		assert.equal(agent.resourceErrors, undefined);
	});

	it("treats absent resource lists as no resources", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "plain.md"),
			markdown("name: plain\ndescription: No resources"),
		);
		const [agent] = discoverAgents(root, "project").agents;
		assert.equal(agent.extensions, undefined);
		assert.equal(agent.skills, undefined);
		assert.equal(agent.resourceErrors, undefined);
	});

	it("records an explicit error for a non-array extensions field", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "bad.md"),
			markdown("name: bad\ndescription: Malformed\nextensions: nope"),
		);
		const [agent] = discoverAgents(root, "project").agents;
		assert.ok(agent.resourceErrors?.some((e) => e.includes('"extensions" must be a YAML array of strings')));
	});

	it("records an explicit error for an explicit null extensions field", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "bad.md"),
			markdown("name: bad\ndescription: Malformed\nextensions: null"),
		);
		const [agent] = discoverAgents(root, "project").agents;
		assert.ok(agent.resourceErrors?.some((e) => e.includes('"extensions" must be a YAML array of strings')));
	});

	it("records an explicit error for an explicit null skills field", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "bad.md"),
			markdown("name: bad\ndescription: Malformed\nskills: ~"),
		);
		const [agent] = discoverAgents(root, "project").agents;
		assert.ok(agent.resourceErrors?.some((e) => e.includes('"skills" must be a YAML array of strings')));
	});

	it("records an explicit error for non-string array items", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "bad.md"),
			markdown("name: bad\ndescription: Malformed\nskills:\n  - 42\n  - ponytail"),
		);
		const [agent] = discoverAgents(root, "project").agents;
		assert.ok(agent.resourceErrors?.some((e) => e.includes('"skills" must be a YAML array of strings')));
	});

	it("treats an empty array as no resources", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "empty.md"),
			markdown("name: empty\ndescription: Empty lists\nextensions: []\nskills: []"),
		);
		const [agent] = discoverAgents(root, "project").agents;
		assert.equal(agent.extensions, undefined);
		assert.equal(agent.skills, undefined);
	});
});

// ---------------------------------------------------------------------------
// Selector resolution (AC2)
// ---------------------------------------------------------------------------

describe("extension selector resolution", () => {
	it("resolves Pi-style package selectors with a subpath", () => {
		const { paths, errors } = resolveExtensionSelectors(["@ff-labs/pi-fff:src"], EXTENSION_CATALOG);
		assert.deepEqual(errors, []);
		assert.deepEqual(paths, [FFF_PATH]);
	});

	it("resolves git package selectors for command-only extensions", () => {
		const { paths, errors } = resolveExtensionSelectors(["DietrichGebert/ponytail:pi-extension"], EXTENSION_CATALOG);
		assert.deepEqual(errors, []);
		assert.deepEqual(paths, [PONYTAIL_EXT_PATH]);
	});

	it("resolves a bare package selector with a scheme prefix", () => {
		const { paths, errors } = resolveExtensionSelectors(["npm:@ff-labs/pi-fff"], EXTENSION_CATALOG);
		assert.deepEqual(errors, []);
		assert.deepEqual(paths, [FFF_PATH]);
	});

	it("resolves unique local extension names", () => {
		const { paths, errors } = resolveExtensionSelectors(["cymbal", "exa-search"], EXTENSION_CATALOG);
		assert.deepEqual(errors, []);
		assert.deepEqual(paths, [CYMBAL_PATH, "extensions/exa-search/index.ts"]);
	});

	it("rejects missing extension selectors with the available set", () => {
		const { paths, errors } = resolveExtensionSelectors(["nope"], EXTENSION_CATALOG);
		assert.deepEqual(paths, []);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /Unknown extension "nope"/);
		assert.match(errors[0], /Available extensions:/);
	});

	it("rejects ambiguous extension selectors instead of guessing", () => {
		const ambiguous: ExtensionCatalogEntry[] = [
			{ path: "extensions/a/cymbal/index.ts", source: "extension" },
			{ path: "extensions/b/cymbal/index.ts", source: "extension" },
		];
		const { paths, errors } = resolveExtensionSelectors(["cymbal"], ambiguous);
		assert.deepEqual(paths, []);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /Ambiguous extension "cymbal"/);
	});

	it("rejects malformed selectors", () => {
		for (const selector of [":src", "foo:", ""]) {
			const { paths, errors } = resolveExtensionSelectors([selector], EXTENSION_CATALOG);
			assert.deepEqual(paths, []);
			assert.ok(errors.length >= 1, `selector "${selector}" must fail`);
		}
		assert.equal(parseExtensionSelector(":src").error, `Malformed extension selector ":src"`);
		assert.equal(parseExtensionSelector("foo:").error, `Malformed extension selector "foo:"`);
		assert.equal(parseExtensionSelector("").error, "Empty extension selector");
	});

	it("absent selectors yield no resource paths", () => {
		const { paths, errors } = resolveExtensionSelectors(undefined, EXTENSION_CATALOG);
		assert.deepEqual(paths, []);
		assert.deepEqual(errors, []);
	});

	it("dedupes repeated selectors resolving to the same path", () => {
		const { paths, errors } = resolveExtensionSelectors(["cymbal", "cymbal"], EXTENSION_CATALOG);
		assert.deepEqual(errors, []);
		assert.deepEqual(paths, [CYMBAL_PATH]);
	});
});

describe("skill selector resolution", () => {
	it("resolves exact parent-loaded skill names", () => {
		const { paths, errors } = resolveSkillSelectors(["ponytail"], SKILL_CATALOG);
		assert.deepEqual(errors, []);
		assert.deepEqual(paths, [PONYTAIL_SKILL_PATH]);
	});

	it("accepts the namespace-qualified skill:name form", () => {
		const { paths, errors } = resolveSkillSelectors(["skill:ponytail"], SKILL_CATALOG);
		assert.deepEqual(errors, []);
		assert.deepEqual(paths, [PONYTAIL_SKILL_PATH]);
	});

	it("rejects missing skill names with the available set", () => {
		const { paths, errors } = resolveSkillSelectors(["missing-skill"], SKILL_CATALOG);
		assert.deepEqual(paths, []);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /Unknown skill "missing-skill"/);
		assert.match(errors[0], /Available skills: ponytail, ponytail-review/);
	});

	it("absent skill selectors yield no resource paths", () => {
		const { paths, errors } = resolveSkillSelectors(undefined, SKILL_CATALOG);
		assert.deepEqual(paths, []);
		assert.deepEqual(errors, []);
	});
});

describe("prevalidateAgents", () => {
	it("resolves every requested agent and accumulates all errors", () => {
		const agents = [
			{ name: "good", description: "ok", systemPrompt: "", source: "project" as const, filePath: "good.md", extensions: ["cymbal"], skills: ["ponytail"] },
			{ name: "bad-ext", description: "ok", systemPrompt: "", source: "project" as const, filePath: "bad-ext.md", extensions: ["nope"] },
			{ name: "bad-skill", description: "ok", systemPrompt: "", source: "project" as const, filePath: "bad-skill.md", skills: ["missing"] },
		];
		const { resolved, errors } = prevalidateAgents(agents, ["good", "bad-ext", "bad-skill"], EXTENSION_CATALOG, SKILL_CATALOG);
		assert.deepEqual(resolved.get("good")!.extensions, [CYMBAL_PATH]);
		assert.deepEqual(resolved.get("good")!.skills, [PONYTAIL_SKILL_PATH]);
		assert.equal(errors.length, 2);
		assert.match(errors[0], /Agent "bad-ext": Unknown extension "nope"/);
		assert.match(errors[1], /Agent "bad-skill": Unknown skill "missing"/);
	});

	it("fails on unknown agents and malformed fields before resolving anything", () => {
		const agents = [
			{
				name: "malformed",
				description: "ok",
				systemPrompt: "",
				source: "project" as const,
				filePath: "malformed.md",
				resourceErrors: ['"extensions" must be a YAML array of strings'],
			},
		];
		const { resolved, errors } = prevalidateAgents(agents, ["malformed", "ghost"], EXTENSION_CATALOG, SKILL_CATALOG);
		assert.equal(resolved.has("ghost"), false);
		assert.equal(errors.length, 2);
		assert.match(errors[0], /Agent "malformed": "extensions" must be a YAML array of strings/);
		assert.match(errors[1], /Unknown agent: "ghost"/);
	});
});

// ---------------------------------------------------------------------------
// Child arguments (AC3)
// ---------------------------------------------------------------------------

describe("child arguments", () => {
	it("passes exactly the selected extension and skill paths, preserving model, tools, and isolation flags", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "worker.md"),
			markdown(
				[
					"name: worker",
					"description: Resource worker",
					"model: openai-codex/gpt-5.6-luna:xhigh",
					"tools: read, grep, find, ls, cymbal",
					"extensions:",
					'  - "@ff-labs/pi-fff:src"',
					"  - cymbal",
					"skills:",
					"  - ponytail",
				].join("\n"),
			),
		);
		const fake = fakeSpawn();
		const { subagent } = registered(fake.spawn);
		await executeAt(subagent, { agent: "worker", task: "work", agentScope: "project" }, root);

		assert.equal(fake.calls.length, 1);
		const args = fake.calls[0].args;
		assert.equal(args.includes("--no-extensions"), true);
		assert.equal(args.includes("--no-skills"), true);
		assert.equal(args.includes("--no-session"), true);
		const flags = resourceFlags(args);
		assert.deepEqual(flags.extensions, [FFF_PATH, CYMBAL_PATH]);
		assert.deepEqual(flags.skills, [PONYTAIL_SKILL_PATH]);
		// The subagent extension must never be added implicitly.
		assert.equal(flags.extensions.includes(SUBAGENT_PATH), false);
		const modelIndex = args.indexOf("--model");
		assert.equal(args[modelIndex + 1], "openai-codex/gpt-5.6-luna:xhigh");
		const toolsIndex = args.indexOf("--tools");
		assert.equal(args[toolsIndex + 1], "read,grep,find,ls,cymbal");
	});

	it("emits no extension or skill flags when the agent lists no resources", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "plain.md"),
			markdown("name: plain\ndescription: No resources\nmodel: openai-codex/gpt-5.6-luna:xhigh"),
		);
		const fake = fakeSpawn();
		const { subagent } = registered(fake.spawn);
		await executeAt(subagent, { agent: "plain", task: "work", agentScope: "project" }, root);
		assert.equal(fake.calls.length, 1);
		const args = fake.calls[0].args;
		assert.equal(args.includes("--no-extensions"), true);
		assert.equal(args.includes("--no-skills"), true);
		assert.deepEqual(resourceFlags(args), { extensions: [], skills: [] });
	});

	it("isolates resources per task in parallel mode", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "worker-a.md"),
			markdown("name: worker-a\ndescription: A\nextensions:\n  - cymbal"),
		);
		await writeFile(
			join(root, ".pi", "agents", "worker-b.md"),
			markdown(
				"name: worker-b\ndescription: B\nextensions:\n  - DietrichGebert/ponytail:pi-extension\nskills:\n  - ponytail-review",
			),
		);
		const fake = fakeSpawn();
		const { subagent } = registered(fake.spawn);
		await executeAt(
			subagent,
			{
				tasks: [
					{ agent: "worker-a", task: "task-a" },
					{ agent: "worker-b", task: "task-b" },
				],
				agentScope: "project",
			},
			root,
		);

		assert.equal(fake.calls.length, 2);
		const callA = fake.calls.find((c) => c.args.at(-1) === "Task: task-a")!;
		const callB = fake.calls.find((c) => c.args.at(-1) === "Task: task-b")!;
		assert.deepEqual(resourceFlags(callA.args), { extensions: [CYMBAL_PATH], skills: [] });
		assert.deepEqual(resourceFlags(callB.args), { extensions: [PONYTAIL_EXT_PATH], skills: [PONYTAIL_REVIEW_SKILL_PATH] });
	});

	it("isolates resources per step in chain mode", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "worker-a.md"),
			markdown("name: worker-a\ndescription: A\nextensions:\n  - cymbal"),
		);
		await writeFile(
			join(root, ".pi", "agents", "worker-b.md"),
			markdown("name: worker-b\ndescription: B\nskills:\n  - ponytail"),
		);
		const fake = fakeSpawn();
		const { subagent } = registered(fake.spawn);
		await executeAt(
			subagent,
			{
				chain: [
					{ agent: "worker-a", task: "step-a" },
					{ agent: "worker-b", task: "step-b {previous}" },
				],
				agentScope: "project",
			},
			root,
		);

		assert.equal(fake.calls.length, 2);
		const callA = fake.calls[0];
		const callB = fake.calls[1];
		assert.deepEqual(resourceFlags(callA.args), { extensions: [CYMBAL_PATH], skills: [] });
		assert.deepEqual(resourceFlags(callB.args), { extensions: [], skills: [PONYTAIL_SKILL_PATH] });
	});

	it("keeps the tool allowlist when resources are present", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "worker.md"),
			markdown("name: worker\ndescription: A\ntools: read, cymbal, exa_contents, exa_search\nextensions:\n  - cymbal\n  - exa-search"),
		);
		const fake = fakeSpawn();
		const { subagent } = registered(fake.spawn);
		await executeAt(subagent, { agent: "worker", task: "work", agentScope: "project" }, root);
		const args = fake.calls[0].args;
		const toolsIndex = args.indexOf("--tools");
		assert.equal(args[toolsIndex + 1], "read,cymbal,exa_contents,exa_search");
	});
});

// ---------------------------------------------------------------------------
// Pre-spawn failures (AC2/AC7)
// ---------------------------------------------------------------------------

describe("pre-spawn failures", () => {
	it("fails parallel calls before spawning any child when an extension is unknown", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "broken.md"),
			markdown("name: broken\ndescription: B\nextensions:\n  - nope"),
		);
		await writeFile(join(root, ".pi", "agents", "worker.md"), markdown("name: worker\ndescription: W"));
		const fake = fakeSpawn();
		const { subagent } = registered(fake.spawn);
		const result = await executeAt(
			subagent,
			{
				tasks: [
					{ agent: "broken", task: "one" },
					{ agent: "worker", task: "two" },
				],
				agentScope: "project",
			},
			root,
		);
		assert.equal(result.isError, true);
		assert.match(text(result), /Unknown extension "nope"/);
		assert.equal(fake.calls.length, 0);
	});

	it("fails chain calls before spawning step one when a later step is invalid", async () => {
		const root = await project();
		await writeFile(join(root, ".pi", "agents", "worker.md"), markdown("name: worker\ndescription: W"));
		await writeFile(
			join(root, ".pi", "agents", "bad.md"),
			markdown("name: bad\ndescription: B\nskills:\n  - missing-skill"),
		);
		const fake = fakeSpawn();
		const { subagent } = registered(fake.spawn);
		const result = await executeAt(
			subagent,
			{
				chain: [
					{ agent: "worker", task: "step-one" },
					{ agent: "bad", task: "step-two" },
				],
				agentScope: "project",
			},
			root,
		);
		assert.equal(result.isError, true);
		assert.match(text(result), /Unknown skill "missing-skill"/);
		assert.equal(fake.calls.length, 0);
	});

	it("fails before spawning when the agent frontmatter is malformed", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "malformed.md"),
			markdown("name: malformed\ndescription: M\nextensions: nope"),
		);
		const fake = fakeSpawn();
		const { subagent } = registered(fake.spawn);
		const result = await executeAt(subagent, { agent: "malformed", task: "work", agentScope: "project" }, root);
		assert.equal(result.isError, true);
		assert.match(text(result), /"extensions" must be a YAML array of strings/);
		assert.equal(fake.calls.length, 0);
	});

	it("fails before spawning when a resource field is explicitly null", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "null-resources.md"),
			markdown("name: null-resources\ndescription: N\nextensions: null"),
		);
		const fake = fakeSpawn();
		const { subagent } = registered(fake.spawn);
		const result = await executeAt(
			subagent,
			{ agent: "null-resources", task: "work", agentScope: "project" },
			root,
		);
		assert.equal(result.isError, true);
		assert.match(text(result), /"extensions" must be a YAML array of strings/);
		assert.equal(fake.calls.length, 0);
	});

	it("fails before spawning on ambiguous selectors", async () => {
		const root = await project();
		await writeFile(
			join(root, ".pi", "agents", "worker.md"),
			markdown("name: worker\ndescription: W\nextensions:\n  - cymbal"),
		);
		const toolsWithDuplicateCymbal: ToolEntry[] = [
			...TOOLS.filter((t) => t.name !== "cymbal" && t.name !== "subagent" && t.name !== "check-workflow-deps"),
			{ name: "cymbal", sourceInfo: { source: "extension", path: "extensions/a/cymbal/index.ts" } },
			{ name: "cymbal2", sourceInfo: { source: "extension", path: "extensions/b/cymbal/index.ts" } },
		];
		const fake = fakeSpawn();
		const { subagent } = registered(fake.spawn, toolsWithDuplicateCymbal);
		const result = await executeAt(subagent, { agent: "worker", task: "work", agentScope: "project" }, root);
		assert.equal(result.isError, true);
		assert.match(text(result), /Ambiguous extension "cymbal"/);
		assert.equal(fake.calls.length, 0);
	});

	it("fails before spawning any task when an agent name is unknown", async () => {
		const root = await project();
		await writeFile(join(root, ".pi", "agents", "worker.md"), markdown("name: worker\ndescription: W"));
		const fake = fakeSpawn();
		const { subagent } = registered(fake.spawn);
		const result = await executeAt(
			subagent,
			{
				tasks: [
					{ agent: "ghost", task: "one" },
					{ agent: "worker", task: "two" },
				],
				agentScope: "project",
			},
			root,
		);
		assert.equal(result.isError, true);
		assert.match(text(result), /Unknown agent: "ghost"/);
		assert.equal(fake.calls.length, 0);
	});
});
