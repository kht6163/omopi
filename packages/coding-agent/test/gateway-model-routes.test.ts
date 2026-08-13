import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import { applyBuiltinGatewayRoutes, CLIPROXYAPI_CODEX_API } from "../src/core/gateway-model-routes.ts";

function makeModel(partial: Partial<Model<Api>> & Pick<Model<Api>, "id" | "api" | "baseUrl">): Model<Api> {
	return {
		name: partial.name ?? partial.id,
		provider: partial.provider ?? "cliproxyapi",
		reasoning: partial.reasoning ?? true,
		input: partial.input ?? ["text"],
		cost: partial.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: partial.contextWindow ?? 200_000,
		maxTokens: partial.maxTokens ?? 16_000,
		compat: partial.compat,
		...partial,
	};
}

describe("applyBuiltinGatewayRoutes", () => {
	test("routes Claude on cliproxy codex API to anthropic-messages and strips backend-api", () => {
		const model = makeModel({
			id: "claude-opus-4-8",
			api: CLIPROXYAPI_CODEX_API as Api,
			baseUrl: "http://127.0.0.1:8317/backend-api/",
		});
		const next = applyBuiltinGatewayRoutes(model, "cliproxyapi");
		expect(next.api).toBe("anthropic-messages");
		expect(next.baseUrl).toBe("http://127.0.0.1:8317");
		expect(next.reasoning).toBe(true);
		expect((next.compat as { forceAdaptiveThinking?: boolean } | undefined)?.forceAdaptiveThinking).toBe(true);
		expect((next.compat as { requiresEnabledThinking?: boolean } | undefined)?.requiresEnabledThinking).toBe(true);
	});

	test("leaves GPT models on the codex API", () => {
		const model = makeModel({
			id: "gpt-5.6-sol",
			api: CLIPROXYAPI_CODEX_API as Api,
			baseUrl: "http://127.0.0.1:8317/backend-api/",
		});
		const next = applyBuiltinGatewayRoutes(model, "cliproxyapi");
		expect(next).toEqual(model);
	});

	test("does not rewrite native Anthropic catalog entries", () => {
		const model = makeModel({
			id: "claude-opus-4-8",
			provider: "anthropic",
			api: "anthropic-messages",
			baseUrl: "https://api.anthropic.com",
		});
		const next = applyBuiltinGatewayRoutes(model, "anthropic");
		expect(next).toEqual(model);
	});

	test("honors explicit forceAdaptiveThinking false", () => {
		const model = makeModel({
			id: "claude-sonnet-5",
			api: CLIPROXYAPI_CODEX_API as Api,
			baseUrl: "http://proxy/backend-api",
			compat: { forceAdaptiveThinking: false },
		});
		const next = applyBuiltinGatewayRoutes(model, "cpa-responses");
		expect(next.api).toBe("anthropic-messages");
		expect((next.compat as { forceAdaptiveThinking?: boolean } | undefined)?.forceAdaptiveThinking).toBe(false);
		expect((next.compat as { requiresEnabledThinking?: boolean } | undefined)?.requiresEnabledThinking).toBe(true);
		expect(next.reasoning).toBe(true);
	});

	test("sets reasoning true even when the catalog row omitted it", () => {
		const model = makeModel({
			id: "claude-opus-4-8",
			api: CLIPROXYAPI_CODEX_API as Api,
			baseUrl: "http://127.0.0.1:8317/backend-api",
			reasoning: false,
		});
		const next = applyBuiltinGatewayRoutes(model, "cliproxyapi");
		expect(next.reasoning).toBe(true);
		expect((next.compat as { requiresEnabledThinking?: boolean } | undefined)?.requiresEnabledThinking).toBe(true);
		expect(next.thinkingLevelMap?.off).toBeNull();
		expect(getSupportedThinkingLevels(next)).not.toContain("off");
		expect(getSupportedThinkingLevels(next)).toContain("low");
	});
});
