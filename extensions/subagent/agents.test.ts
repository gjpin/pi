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
