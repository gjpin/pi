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

// Read the checked-in resource once (module scope so every describe can use it)
async function readExplorer(): Promise<{ frontmatter: Record<string, string>; body: string }> {
	const root = resolve(import.meta.dirname, "../..");
	return parseFrontmatter<Record<string, string>>(
		await readFile(join(root, ".pi/agents/codebase-explorer.md"), "utf8"),
	);
}

describe("codebase-explorer", () => {

	it("is discoverable among project agents with the checked-in resource", async () => {
		const { agents, nested } = await project();
		const checked = await readExplorer();
		// Copy the checked-in file into the test project
		await writeFile(
			join(agents, "codebase-explorer.md"),
			`---\nname: ${checked.frontmatter.name}\ndescription: ${checked.frontmatter.description}\nmodel: ${checked.frontmatter.model}\ntools: ${checked.frontmatter.tools}\n---\n\n${checked.body}`,
		);

		const found = discoverAgents(nested, "project");
		const explorer = found.agents.find((a) => a.name === "codebase-explorer");
		assert.ok(explorer, "codebase-explorer must be discoverable");
		assert.equal(explorer.model, "openrouter/deepseek/deepseek-v4-flash-0731:max");
	});

	it("is read-only: no bash, edit, or write tools", async () => {
		const checked = await readExplorer();
		const tools = (checked.frontmatter.tools || "").split(/,\s*/).map((t) => t.trim());
		assert.ok(tools.includes("read"), "explorer must have read");
		assert.ok(tools.includes("grep"), "explorer must have grep");
		assert.ok(tools.includes("find"), "explorer must have find");
		assert.ok(tools.includes("ls"), "explorer must have ls");
		assert.ok(tools.includes("cymbal"), "explorer must have cymbal");
		assert.equal(tools.includes("bash"), false, "explorer must not have bash");
		assert.equal(tools.includes("edit"), false, "explorer must not have edit");
		assert.equal(tools.includes("write"), false, "explorer must not have write");
	});

	it("has evidence-packet sections in the prompt body", async () => {
		const checked = await readExplorer();
		assert.match(checked.body, /Repository shape/);
		assert.match(checked.body, /Relevant paths and symbols/);
		assert.match(checked.body, /Flow/);
		assert.match(checked.body, /Reusable patterns/);
		assert.match(checked.body, /Tests and checks/);
		assert.match(checked.body, /Risks and unknowns/);
		assert.match(checked.body, /Concrete evidence/);
	});

	it("routes Cymbal before FFF, uses documented commands, and labels fallback coverage", async () => {
		const checked = await readExplorer();
		assert.match(checked.body, /Cymbal preferred/);
		assert.match(checked.body, /FFF-backed find/);
		// Documented Cymbal navigation commands
		assert.match(checked.body, /structure/);
		assert.match(checked.body, /investigate/);
		assert.match(checked.body, /trace/);
		assert.match(checked.body, /impact/);
		assert.match(checked.body, /show/);
		assert.match(checked.body, /outline/);
		assert.match(checked.body, /search/);
		assert.match(checked.body, /refs/);
		assert.match(checked.body, /context/);
		assert.match(checked.body, /reduced.*FFF only/);
	});

	it("requires approximately 800-word evidence packet", async () => {
		const checked = await readExplorer();
		assert.match(checked.body, /approximately 800 words/);
	});

	it("FFF navigation guidance is present in feature-implementer", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const implementer = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/agents/feature-implementer.md"), "utf8"),
		);
		assert.match(implementer.body, /Cymbal/);
		assert.match(implementer.body, /FFF/);
		assert.match(implementer.frontmatter.tools, /(?:^|,)\s*cymbal\s*(?:,|$)/);
	});

	it("FFF navigation guidance is present in feature-reviewer without write tools", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const reviewer = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/agents/feature-reviewer.md"), "utf8"),
		);
		assert.match(reviewer.body, /Cymbal/);
		assert.match(reviewer.body, /FFF/);
		assert.match(reviewer.frontmatter.tools, /(?:^|,)\s*cymbal\s*(?:,|$)/);
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

	it("prompt has dependency checks in preflight using check-workflow-deps tool", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const prompt = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/prompts/feature.md"), "utf8"),
		);
		// Must invoke the registered check-workflow-deps tool, not shell probes
		assert.match(prompt.body, /check-workflow-deps/);
		assert.match(prompt.body, /isError/);
		assert.match(prompt.body, /dependency/);
		assert.match(prompt.body, /install.*modify/);
		// Shell probe no longer present
		assert.doesNotMatch(prompt.body, /fff-version/);
		assert.doesNotMatch(prompt.body, /2>&1/);
	});

	it("Cymbal guidance in implementer uses documented commands", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const implementer = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/agents/feature-implementer.md"), "utf8"),
		);
		assert.match(implementer.body, /trace/);
		assert.match(implementer.body, /impact/);
		assert.match(implementer.body, /show/);
		assert.match(implementer.body, /structure/);
		assert.match(implementer.body, /refs/);
	});

	it("Cymbal guidance in reviewer uses documented commands", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const reviewer = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/agents/feature-reviewer.md"), "utf8"),
		);
		assert.match(reviewer.body, /trace/);
		assert.match(reviewer.body, /impact/);
		assert.match(reviewer.body, /show/);
		assert.match(reviewer.body, /refs/);
		assert.match(reviewer.body, /context/);
	});

	it("retry policy: exactly one retry, then stop with choices", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const prompt = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/prompts/feature.md"), "utf8"),
		);
		assert.match(prompt.body, /retry exactly once/);
		assert.match(prompt.body, /second attempt/);
		assert.match(prompt.body, /continue without exploration/);
	});

	it("explorer task instruction includes cwd", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const prompt = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/prompts/feature.md"), "utf8"),
		);
		assert.match(prompt.body, /cwd/);
	});

	it("explorer task instruction includes clarified functional request", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const prompt = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/prompts/feature.md"), "utf8"),
		);
		assert.match(prompt.body, /clarified functional request/);
	});

	it("usage reporting is preserved", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const prompt = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/prompts/feature.md"), "utf8"),
		);
		// The prompt should reference the subagent tool which collects usage
		assert.match(prompt.body, /subagent/);
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
		assert.equal(implementer.frontmatter.model, "openrouter/deepseek/deepseek-v4-flash-0731:max");
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

describe("checked-in role resource matrix", () => {
	it("codebase-explorer selects pi-fff and cymbal extensions, no skills, read-only tools", async () => {
		const checked = await readExplorer();
		assert.deepEqual(checked.frontmatter.extensions, ["@ff-labs/pi-fff:src", "cymbal"]);
		assert.equal(checked.frontmatter.skills, undefined);
		const tools = (checked.frontmatter.tools || "").split(/,\s*/);
		assert.deepEqual(tools, ["read", "grep", "find", "ls", "cymbal"]);
		assert.equal(tools.includes("exa_contents"), false, "explorer must not get exa tools");
		assert.equal(tools.includes("exa_search"), false, "explorer must not get exa tools");
	});

	it("feature-implementer selects the full approved matrix with exa tools and ponytail skill", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const implementer = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/agents/feature-implementer.md"), "utf8"),
		);
		assert.deepEqual(implementer.frontmatter.extensions, [
			"@ff-labs/pi-fff:src",
			"DietrichGebert/ponytail:pi-extension",
			"exa-contents",
			"exa-search",
			"cymbal",
		]);
		assert.deepEqual(implementer.frontmatter.skills, ["ponytail"]);
		const tools = (implementer.frontmatter.tools || "").split(/,\s*/);
		assert.deepEqual(tools, [
			"read",
			"grep",
			"find",
			"ls",
			"bash",
			"edit",
			"write",
			"cymbal",
			"exa_contents",
			"exa_search",
		]);
	});

	it("feature-reviewer selects pi-fff and cymbal extensions with ponytail-review skill and stays read-only", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const reviewer = parseFrontmatter<Record<string, string>>(
			await readFile(join(root, ".pi/agents/feature-reviewer.md"), "utf8"),
		);
		assert.deepEqual(reviewer.frontmatter.extensions, ["@ff-labs/pi-fff:src", "cymbal"]);
		assert.deepEqual(reviewer.frontmatter.skills, ["ponytail-review"]);
		const tools = (reviewer.frontmatter.tools || "").split(/,\s*/);
		assert.deepEqual(tools, ["read", "grep", "find", "ls", "bash", "cymbal"]);
		assert.equal(tools.includes("exa_contents"), false, "reviewer must not get exa tools");
		assert.equal(tools.includes("exa_search"), false, "reviewer must not get exa tools");
	});

	it("all three checked-in roles parse cleanly through discoverAgents with exact resources", async () => {
		const root = resolve(import.meta.dirname, "../..");
		const found = discoverAgents(root, "project");
		const byName = new Map(found.agents.map((a) => [a.name, a]));
		const explorer = byName.get("codebase-explorer");
		const implementer = byName.get("feature-implementer");
		const reviewer = byName.get("feature-reviewer");
		assert.ok(explorer, "codebase-explorer must be discovered from the checked-in .pi/agents");
		assert.ok(implementer, "feature-implementer must be discovered from the checked-in .pi/agents");
		assert.ok(reviewer, "feature-reviewer must be discovered from the checked-in .pi/agents");
		for (const agent of [explorer!, implementer!, reviewer!]) {
			assert.equal(agent.resourceErrors, undefined, `${agent.name} must parse without resource errors`);
			assert.equal(agent.source, "project");
		}
		assert.deepEqual(explorer!.extensions, ["@ff-labs/pi-fff:src", "cymbal"]);
		assert.equal(explorer!.skills, undefined);
		assert.deepEqual(explorer!.tools, ["read", "grep", "find", "ls", "cymbal"]);
		assert.deepEqual(implementer!.extensions, [
			"@ff-labs/pi-fff:src",
			"DietrichGebert/ponytail:pi-extension",
			"exa-contents",
			"exa-search",
			"cymbal",
		]);
		assert.deepEqual(implementer!.skills, ["ponytail"]);
		assert.deepEqual(implementer!.tools, [
			"read",
			"grep",
			"find",
			"ls",
			"bash",
			"edit",
			"write",
			"cymbal",
			"exa_contents",
			"exa_search",
		]);
		assert.deepEqual(reviewer!.extensions, ["@ff-labs/pi-fff:src", "cymbal"]);
		assert.deepEqual(reviewer!.skills, ["ponytail-review"]);
		assert.deepEqual(reviewer!.tools, ["read", "grep", "find", "ls", "bash", "cymbal"]);
	});
});
