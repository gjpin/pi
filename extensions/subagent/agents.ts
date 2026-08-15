/**
 * Adapted from the subagent example shipped with
 * @earendil-works/pi-coding-agent 0.83.0.
 *
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
	/** Explicit parent-loaded extension selectors (Pi-style package selectors or unique local names). */
	extensions?: string[];
	/** Explicit parent-loaded skill names. */
	skills?: string[];
	/** Frontmatter resource field shape errors, surfaced before any child spawn. */
	resourceErrors?: string[];
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

/**
 * Validate an optional YAML-array resource field (extensions / skills).
 * Absent or null fields yield no resources. Any other shape records an
 * explicit error so the caller can fail before spawning a child.
 */
function parseResourceList(field: unknown, fieldName: string, resourceErrors: string[]): string[] | undefined {
	if (field === undefined || field === null) return undefined;
	if (!Array.isArray(field) || field.some((item) => typeof item !== "string" || item.trim() === "")) {
		resourceErrors.push(`"${fieldName}" must be a YAML array of strings`);
		return undefined;
	}
	const values = (field as string[]).map((item) => item.trim());
	return values.length > 0 ? values : undefined;
}

function parseTools(field: unknown, resourceErrors: string[]): string[] | undefined {
	if (field === undefined || field === null) return undefined;
	if (typeof field !== "string") {
		resourceErrors.push(`"tools" must be a comma-separated string`);
		return undefined;
	}
	const tools = field
		.split(",")
		.map((t: string) => t.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);

		const name = typeof frontmatter.name === "string" ? frontmatter.name : undefined;
		const description = typeof frontmatter.description === "string" ? frontmatter.description : undefined;
		if (!name || !description) {
			continue;
		}

		const resourceErrors: string[] = [];
		const tools = parseTools(frontmatter.tools, resourceErrors);
		const extensions = parseResourceList(frontmatter.extensions, "extensions", resourceErrors);
		const skills = parseResourceList(frontmatter.skills, "skills", resourceErrors);

		agents.push({
			name,
			description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			systemPrompt: body,
			source,
			filePath,
			extensions,
			skills,
			resourceErrors: resourceErrors.length > 0 ? resourceErrors : undefined,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
