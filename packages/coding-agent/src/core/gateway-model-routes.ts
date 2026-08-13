/**
 * Built-in model wire-format fixes for mixed gateway catalogs.
 *
 * Extensions such as `@router-for-me/pi-cliproxyapi-provider` register every
 * catalog entry under a single Codex/Responses API (`cliproxyapi-codex-responses`)
 * because that is the package's unified CPA path. Claude models still need
 * Anthropic Messages framing (`/v1/messages`) so thinking, tool calls, and
 * session-title generation match Anthropic semantics. CLIProxy also requires
 * thinking to stay enabled or adaptive on every request (`clear_thinking_*`).
 *
 * These defaults run for every omopi user — no models.json entry required.
 * User `modelRoutes` / `modelOverrides` still win when they set a different api.
 */

import type { Api, Model } from "@earendil-works/pi-ai";

/** API id used by pi-cliproxyapi-provider for all models. */
export const CLIPROXYAPI_CODEX_API = "cliproxyapi-codex-responses" as const;

const CLAUDE_ID = /^claude(?:[-_/]|$)/i;
const CLIPROXY_PROVIDER = /^(cliproxyapi|cpa-responses)$/i;

function stripBackendApiBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.replace(/\/+$/, "");
	const stripped = trimmed.replace(/\/backend-api$/i, "");
	return stripped.length > 0 ? stripped : baseUrl;
}

function isCliproxyCodexModel(model: Model<Api>, providerId: string): boolean {
	if (model.api === CLIPROXYAPI_CODEX_API) return true;
	return CLIPROXY_PROVIDER.test(providerId) && /codex-responses/i.test(String(model.api));
}

function isClaudeModel(model: Model<Api>): boolean {
	return CLAUDE_ID.test(model.id) || (typeof model.name === "string" && CLAUDE_ID.test(model.name));
}

/**
 * Rewrite Claude entries on CLIProxy-style Codex catalogs to Anthropic Messages.
 * Leaves non-Claude models (GPT, Gemini, …) on the extension's Codex path.
 */
export function applyBuiltinGatewayRoutes(model: Model<Api>, providerId: string): Model<Api> {
	if (!isCliproxyCodexModel(model, providerId) || !isClaudeModel(model)) {
		return model;
	}

	const forceAdaptive =
		model.compat && "forceAdaptiveThinking" in model.compat && model.compat.forceAdaptiveThinking === false
			? false
			: true;

	return {
		...model,
		api: "anthropic-messages" as Api,
		baseUrl: stripBackendApiBaseUrl(model.baseUrl),
		// CLIProxy Claude catalogs sometimes omit `reasoning`. The Anthropic
		// adapter only emits a thinking field when this is true.
		reasoning: true,
		// Off is not a real control: CLIProxy rejects disabled thinking.
		thinkingLevelMap: {
			...model.thinkingLevelMap,
			off: null,
		},
		compat: {
			...model.compat,
			forceAdaptiveThinking: forceAdaptive,
			// CLIProxy `clear_thinking_*` rejects disabled/omitted thinking on
			// every request, including regular chat after tool-history replay.
			requiresEnabledThinking: true,
		},
	};
}
