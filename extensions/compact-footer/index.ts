/**
 * Compact Footer
 *
 * Replaces pi's built-in footer with the same useful session statistics, but
 * omits the working-directory line and prompt-cache statistics (R, W, CH).
 *
 * Load this extension with:
 *
 *   pi -e ./extensions/compact-footer.ts
 *
 * Or keep it in a discovered extensions directory for automatic loading.
 */

import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface UsageTotals {
	input: number;
	output: number;
	cost: number;
}

/** Match pi's compact token formatting. */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function addUsage(totals: UsageTotals, usage: Usage): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cost += usage.cost.total;
}

/**
 * Keep the built-in footer's cumulative accounting, while deliberately not
 * retaining cache-read/cache-write fields for display.
 */
function getUsageTotals(entries: readonly SessionEntry[]): UsageTotals {
	const totals: UsageTotals = { input: 0, output: 0, cost: 0 };

	for (const entry of entries) {
		let usage: Usage | undefined;

		if (entry.type === "message") {
			if (entry.message.role === "assistant") {
				usage = (entry.message as AssistantMessage).usage;
			} else if (entry.message.role === "toolResult") {
				usage = (entry.message as ToolResultMessage).usage;
			}
		} else if (
			(entry.type === "branch_summary" || entry.type === "compaction") &&
			entry.usage
		) {
			usage = entry.usage;
		}

		if (usage) addUsage(totals, usage);
	}

	return totals;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		// setFooter is a TUI customization; leave non-interactive modes alone.
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((_tui, theme, footerData) => ({
			invalidate() {},

			render(width: number): string[] {
				const usage = getUsageTotals(ctx.sessionManager.getEntries());
				const statsParts: string[] = [];

				if (usage.input) statsParts.push(`↑${formatTokens(usage.input)}`);
				if (usage.output) statsParts.push(`↓${formatTokens(usage.output)}`);

				const usingSubscription = ctx.model
					? ctx.model.provider === "kimi-coding" ||
						ctx.modelRegistry.isUsingOAuth(ctx.model)
					: false;
				if (usage.cost || usingSubscription) {
					statsParts.push(
						`$${usage.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`,
					);
				}

				const contextUsage = ctx.getContextUsage();
				const contextWindow =
					contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
				const contextPercent = contextUsage?.percent;
				const contextDisplay =
					contextPercent === null || contextPercent === undefined
						? `?/${formatTokens(contextWindow)}`
						: `${contextPercent.toFixed(1)}%/${formatTokens(contextWindow)}`;
				const contextPercentValue = contextPercent ?? 0;

				let contextPercentString: string;
				if (contextPercentValue > 90) {
					contextPercentString = theme.fg("error", contextDisplay);
				} else if (contextPercentValue > 70) {
					contextPercentString = theme.fg("warning", contextDisplay);
				} else {
					contextPercentString = contextDisplay;
				}
				statsParts.push(contextPercentString);

				if (process.env.PI_EXPERIMENTAL === "1") {
					statsParts.push(
						`${theme.fg("text", "•")} ${theme.bold(theme.fg("warning", "xp"))}`,
					);
				}

				let statsLeft = statsParts.join(" ");
				let statsLeftWidth = visibleWidth(statsLeft);
				if (statsLeftWidth > width) {
					statsLeft = truncateToWidth(statsLeft, width, "...");
					statsLeftWidth = visibleWidth(statsLeft);
				}

				const modelName = ctx.model?.id || "no-model";
				let rightSideWithoutProvider = modelName;
				if (ctx.model?.reasoning) {
					const thinkingLevel = ctx.thinkingLevel || "off";
					rightSideWithoutProvider =
						thinkingLevel === "off"
							? `${modelName} • thinking off`
							: `${modelName} • ${thinkingLevel}`;
				}

				let rightSide = rightSideWithoutProvider;
				if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
					rightSide = `(${ctx.model.provider}) ${rightSideWithoutProvider}`;
					if (statsLeftWidth + 2 + visibleWidth(rightSide) > width) {
						rightSide = rightSideWithoutProvider;
					}
				}

				const rightSideWidth = visibleWidth(rightSide);
				const totalNeeded = statsLeftWidth + 2 + rightSideWidth;
				let statsLine: string;
				if (totalNeeded <= width) {
					const padding = " ".repeat(
						width - statsLeftWidth - rightSideWidth,
					);
					statsLine = statsLeft + padding + rightSide;
				} else {
					const availableForRight = width - statsLeftWidth - 2;
					if (availableForRight > 0) {
						const truncatedRight = truncateToWidth(
							rightSide,
							availableForRight,
							"",
						);
						const truncatedRightWidth = visibleWidth(truncatedRight);
						const padding = " ".repeat(
							Math.max(0, width - statsLeftWidth - truncatedRightWidth),
						);
						statsLine = statsLeft + padding + truncatedRight;
					} else {
						statsLine = statsLeft;
					}
				}

				const footerStatsLeft = theme.fg("text", statsLeft);
				const remainder = statsLine.slice(statsLeft.length);
				const footerRemainder = theme.fg("text", remainder);
				const lines = [footerStatsLeft + footerRemainder];

				const statuses = Array.from(footerData.getExtensionStatuses().entries())
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, text]) => sanitizeStatusText(text))
					.filter(Boolean);
				if (statuses.length > 0) {
					lines.push(
						theme.fg(
							"text",
							truncateToWidth(statuses.join(" "), width, "..."),
						),
					);
				}

				return lines;
			},
		}));
	});
}
