/**
 * Cymbal Extension — independent read-only code navigation.
 *
 * Registers a single `cymbal` tool that wraps the Cymbal CLI
 * (https://github.com/1broseidon/cymbal) with a read-only command
 * allowlist, cancellation, non-zero error propagation, argument
 * forwarding, and 50 KB output truncation. The subagent extension does
 * not provide this tool; load this extension in the parent launch and
 * allowlist `cymbal` for any agent that should use it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const CYMBAL_COMMANDS = [
	"structure",
	"investigate",
	"trace",
	"impact",
	"show",
	"outline",
	"search",
	"refs",
	"context",
	"ls",
	"impls",
	"importers",
	"diff",
	"changed",
	"version",
] as const;

export type CymbalCommand = (typeof CYMBAL_COMMANDS)[number];

const ALLOWED_CYMBAL_COMMANDS = new Set(CYMBAL_COMMANDS);
const CYMBAL_OUTPUT_CAP = 50 * 1024;

export function registerCymbal(pi: ExtensionAPI) {
	pi.registerTool({
		name: "cymbal",
		label: "Cymbal",
		description: [
			"Run a read-only Cymbal navigation command (structure, investigate, trace, impact, show, outline, search, refs, context, ls, impls, importers, diff, changed, version).",
			"Cannot invoke mutating Cymbal commands or arbitrary shell.",
			"Errors and truncation are reported in the output.",
		].join(" "),
		promptSnippet: "Explore existing code with read-only Cymbal navigation commands.",
		promptGuidelines: [
			"Prefer the cymbal tool over Read, Grep, Glob, or Bash when the task touches existing code: start with `search` to find a symbol, then `investigate` (or `context` for source+callers+imports) to understand it, `trace`/`impact`/`refs`/`impls` for flow, and `show`/`outline` before reading files.",
			"Trust the first search rank; if one or two searches miss, stop retrying synonyms and pivot to implementation seams surfaced by `structure` (spec, registry, dispatch, config, store, provider, ...).",
			"Do not run both `investigate` and `context` on the same symbol, do not `Read` a large file without `outline` first, do not run `cymbal index` manually, and do not default to `--graph` when you need precise call sites or source lines.",
			"The tool is strictly read-only: only the allowlisted navigation commands are accepted, and mutating commands or arbitrary shell are rejected.",
		],
		parameters: Type.Object({
			command: Type.String({
				description: "Cymbal subcommand to run (read-only navigation commands only)",
			}),
			args: Type.Optional(
				Type.Array(Type.String(), {
					description: "Arguments for the subcommand",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const command = params.command as string;
			if (!ALLOWED_CYMBAL_COMMANDS.has(command)) {
				throw new Error(`Invalid cymbal command: "${command}". Allowed: ${CYMBAL_COMMANDS.join(", ")}.`);
			}

			const args = (params.args as string[]) ?? [];
			if (signal?.aborted) {
				throw new Error("cymbal execution aborted");
			}

			const result = await pi.exec("cymbal", [command, ...args], { signal });

			if (result.code !== 0 && result.code !== undefined) {
				const errMsg = (result.stderr || result.stdout || "").trim();
				throw new Error(errMsg || `cymbal "${command}" exited with code ${result.code}`);
			}

			const fullOutput = result.stdout + (result.stderr ? `\n${result.stderr}` : "");
			const byteLength = Buffer.byteLength(fullOutput, "utf8");
			if (byteLength > CYMBAL_OUTPUT_CAP) {
				let truncated = fullOutput.slice(0, CYMBAL_OUTPUT_CAP);
				while (Buffer.byteLength(truncated, "utf8") > CYMBAL_OUTPUT_CAP) {
					truncated = truncated.slice(0, -1);
				}
				return {
					content: [
						{
							type: "text" as const,
							text: `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`,
						},
					],
					details: { fullOutput },
				};
			}

			return {
				content: [{ type: "text" as const, text: fullOutput }],
			};
		},
	});
}

export default registerCymbal;
