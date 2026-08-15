import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

import { discoverAgents, formatAgentList } from "./agents.ts";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<{ root: string; agents: string; nested: string }> {
	const root = await mkdtemp(join(tmpdir(), "pi-subagent-agents-"));
	tempDirs.push(root);
	const agents = join(root, ".pi", "agents");
	const nested = join(root, "packages", "app");
	await Promise.all([mkdir(agents, { recursive: true }), mkdir(nested, { recursive: true })]);
	return { root, agents, nested };
}

function markdown(frontmatter: string, body = "Do the task."): string {
	return `---\n${frontmatter}\n---\n\n${body}\n`;
}

describe("discoverAgents", () => {
	it("uses the nearest project agents directory and preserves model/tools", async () => {
		const { agents, nested } = await project();
		await writeFile(
			join(agents, "worker.md"),
			markdown(
				"name: worker\ndescription: Test worker\nmodel: openai-codex/gpt-5.6-luna:xhigh\ntools: read,  grep, bash",
			),
		);

		const found = discoverAgents(nested, "project");
		assert.equal(found.projectAgentsDir, agents);
		assert.equal(found.agents.length, 1);
		assert.equal(found.agents[0].model, "openai-codex/gpt-5.6-luna:xhigh");
		assert.deepEqual(found.agents[0].tools, ["read", "grep", "bash"]);
		assert.equal(found.agents[0].source, "project");
	});

	it("ignores markdown without both required fields", async () => {
		const { agents, nested } = await project();
		await Promise.all([
			writeFile(join(agents, "missing-name.md"), markdown("description: Missing name")),
			writeFile(join(agents, "missing-description.md"), markdown("name: missing-description")),
		]);

		assert.deepEqual(discoverAgents(nested, "project").agents, []);
	});
});

describe("formatAgentList", () => {
	it("reports truncation", () => {
		const agents = ["one", "two", "three"].map((name) => ({
			name,
			description: `${name} description`,
			systemPrompt: "",
			source: "project" as const,
			filePath: `${name}.md`,
		}));

		const formatted = formatAgentList(agents, 2);
		assert.match(formatted.text, /one \(project\)/);
		assert.match(formatted.text, /two \(project\)/);
		assert.doesNotMatch(formatted.text, /three \(project\)/);
		assert.equal(formatted.remaining, 1);
	});
});

describe("codebase-explorer", () => {
	it("is discoverable among project agents", async () => {
		const { agents, nested } = await project();
		await writeFile(
			join(agents, "codebase-explorer.md"),
			markdown(
				"name: codebase-explorer\ndescription: Codebase discovery agent\nmodel: openrouter/deepseek/deepseek-v4-flash\ntools: read, grep, find, ls, bash",
			),
		);

		const found = discoverAgents(nested, "project");
		const explorer = found.agents.find((a) => a.name === "codebase-explorer");
		assert.ok(explorer, "codebase-explorer must be discoverable");
		assert.equal(explorer.model, "openrouter/deepseek/deepseek-v4-flash");
		assert.ok(explorer.tools);
		assert.ok(explorer.tools.includes("read"));
		assert.ok(explorer.tools.includes("grep"));
		assert.ok(explorer.tools.includes("find"));
		assert.ok(explorer.tools.includes("ls"));
		assert.ok(explorer.tools.includes("bash"));
	});

	it("is read-only (no edit or write tools)", async () => {
		const { agents, nested } = await project();
		await writeFile(
			join(agents, "codebase-explorer.md"),
			markdown(
				"name: codebase-explorer\ndescription: Codebase discovery agent\nmodel: openrouter/deepseek/deepseek-v4-flash\ntools: read, grep, find, ls, bash",
			),
		);

		const found = discoverAgents(nested, "project");
		const explorer = found.agents.find((a) => a.name === "codebase-explorer");
		assert.ok(explorer);
		assert.ok(explorer.tools);
		assert.equal(explorer.tools.includes("edit"), false, "explorer must not have edit");
		assert.equal(explorer.tools.includes("write"), false, "explorer must not have write");
	});

	it("has evidence-packet sections in the prompt body", async () => {
		const { agents, nested } = await project();
		await writeFile(
			join(agents, "codebase-explorer.md"),
			markdown(
				"name: codebase-explorer\ndescription: Codebase discovery agent\nmodel: openrouter/deepseek/deepseek-v4-flash\ntools: read, grep, find, ls, bash",
				[
					"- **Repository shape** \u2014 language, framework, build system",
					"- **Relevant paths and symbols** \u2014 files, modules, types",
					"- **Flow** \u2014 key control flow, data flow",
					"- **Reusable patterns** \u2014 existing abstractions",
					"- **Tests and checks** \u2014 relevant test files",
					"- **Risks and unknowns** \u2014 areas of impact",
					"- **Concrete evidence** \u2014 specific line references",
				].join("\n"),
			),
		);

		const found = discoverAgents(nested, "project");
		const explorer = found.agents.find((a) => a.name === "codebase-explorer");
		assert.ok(explorer);
		assert.match(explorer.systemPrompt, /Repository shape/);
		assert.match(explorer.systemPrompt, /Relevant paths and symbols/);
		assert.match(explorer.systemPrompt, /Flow/);
		assert.match(explorer.systemPrompt, /Reusable patterns/);
		assert.match(explorer.systemPrompt, /Tests and checks/);
		assert.match(explorer.systemPrompt, /Risks and unknowns/);
		assert.match(explorer.systemPrompt, /Concrete evidence/);
	});

	it("routes Cymbal before FFF and labels fallback coverage", async () => {
		const { agents, nested } = await project();
		await writeFile(
			join(agents, "codebase-explorer.md"),
			markdown(
				"name: codebase-explorer\ndescription: Codebase discovery agent\nmodel: openrouter/deepseek/deepseek-v4-flash\ntools: read, grep, find, ls, bash",
				[
					"1. **Cymbal preferred.**",
					"2. **FFF-backed find/grep.**",
					"3. **Cymbal fallback label.** If Cymbal cannot provide semantic coverage",
					"**Coverage: reduced (FFF only)**",
					"Do not fail exploration",
				].join("\n"),
			),
		);

		const found = discoverAgents(nested, "project");
		const explorer = found.agents.find((a) => a.name === "codebase-explorer");
		assert.ok(explorer);
		assert.match(explorer.systemPrompt, /Cymbal preferred/);
		assert.match(explorer.systemPrompt, /FFF-backed find/);
		assert.match(explorer.systemPrompt, /Cymbal fallback label/);
		assert.match(explorer.systemPrompt, /reduced.*FFF only/);
	});

	it("FFF navigation guidance is present in feature-implementer", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const implementer = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/agents/feature-implementer.md"), "utf8"),
		);
		assert.match(implementer.body, /Cymbal/);
		assert.match(implementer.body, /FFF/);
	});

	it("FFF navigation guidance is present in feature-reviewer without write tools", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const reviewer = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/agents/feature-reviewer.md"), "utf8"),
		);
		assert.match(reviewer.body, /Cymbal/);
		assert.match(reviewer.body, /FFF/);
		// Reviewer must remain read-only
		assert.doesNotMatch(reviewer.frontmatter.tools, /(?:^|,)\s*(?:edit|write)\s*(?:,|$)/);
	});

	it("prompt has exploration routing order and retry policy", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const prompt = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/prompts/feature.md"), "utf8"),
		);
		assert.match(prompt.body, /codebase-explorer/);
		assert.match(prompt.body, /retry exactly once/);
		assert.match(prompt.body, /retry.*continue/);
	});

	it("prompt invalidates exploration on material requirement changes", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const prompt = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/prompts/feature.md"), "utf8"),
		);
		assert.match(prompt.body, /invalidate/);
		assert.match(prompt.body, /fresh report/);
	});

	it("prompt has dependency checks in preflight", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const prompt = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/prompts/feature.md"), "utf8"),
		);
		assert.match(prompt.body, /cymbal version/);
		assert.match(prompt.body, /FFF/);
		assert.match(prompt.body, /dependency/);
		assert.match(prompt.body, /install.*modify/);
	});

	it("implementer and reviewer retain existing result contract", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const implementer = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/agents/feature-implementer.md"), "utf8"),
		);
		const reviewer = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/agents/feature-reviewer.md"), "utf8"),
		);
		// Implementer must still have the ## Status / ## Task / ## Commit / ## Checks output shape
		assert.match(implementer.body, /## Status/);
		assert.match(implementer.body, /## Task/);
		assert.match(implementer.body, /## Commit/);
		assert.match(implementer.body, /## Checks/);
		// Reviewer must still have Scope Coverage, Critical, Warnings, Suggestions, Verdict
		assert.match(reviewer.body, /## Scope Coverage/);
		assert.match(reviewer.body, /## Critical/);
		assert.match(reviewer.body, /## Warnings/);
		assert.match(reviewer.body, /## Suggestions/);
		assert.match(reviewer.body, /## Verdict/);
	});
});

describe("feature resources", () => {
	it("have exact role models, safe reviewer tools, and approval gates", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const implementer = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/agents/feature-implementer.md"), "utf8"),
		);
		const reviewer = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/agents/feature-reviewer.md"), "utf8"),
		);
		const prompt = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/prompts/feature.md"), "utf8"),
		);

		assert.equal(implementer.frontmatter.name, "feature-implementer");
		assert.ok(implementer.frontmatter.description);
		assert.equal(implementer.frontmatter.model, "openrouter/deepseek/deepseek-v4-flash");
		assert.equal(reviewer.frontmatter.name, "feature-reviewer");
		assert.ok(reviewer.frontmatter.description);
		assert.equal(reviewer.frontmatter.model, "openai-codex/gpt-5.6-luna:xhigh");
		assert.doesNotMatch(reviewer.frontmatter.tools, /(?:^|,)\s*(?:edit|write)\s*(?:,|$)/);
		assert.ok(prompt.frontmatter.description);
		assert.match(prompt.body, /\$@/);
		assert.match(prompt.body, /approve scope/);
		assert.match(prompt.body, /approve plan/);
		// task-detail and proportionality guidance (T1)
		assert.match(prompt.body, /context-free implementer/);
		assert.match(prompt.body, /behavioral change/);
		assert.match(prompt.body, /observable result/);
		assert.match(prompt.body, /starting files/);
		assert.match(prompt.body, /code areas/);
		assert.match(prompt.body, /edge cases/);
		assert.match(prompt.body, /failure behavior/);
		assert.match(prompt.body, /data contracts/);
		assert.match(prompt.body, /boundaries/);
		assert.match(prompt.body, /prohibited scope/);
		assert.match(prompt.body, /test changes/);
		assert.match(prompt.body, /exact checks/);
		assert.match(prompt.body, /relevant rather than exhaustive/);
		assert.match(prompt.body, /do not duplicate/);
		assert.match(prompt.body, /prescribe line-by-line/);
		assert.match(prompt.body, /dictate mechanics/);
	});
});
