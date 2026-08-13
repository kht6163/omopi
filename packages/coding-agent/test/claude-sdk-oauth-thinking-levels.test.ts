import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getModels } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { claudeSdkOauthThinkingLevelMap } from "../src/core/extensions/builtin/claude-sdk-oauth/index.ts";

describe("claude-sdk-oauth thinking levels", () => {
	it("hides off and minimal because the SDK cannot turn adaptive thinking off", () => {
		const source = getModels("anthropic").find((model) => model.id === "claude-opus-4-8");
		expect(source).toBeDefined();
		const oauthModel = {
			...source!,
			provider: "claude-sdk-oauth",
			api: "claude-sdk-oauth" as const,
			thinkingLevelMap: claudeSdkOauthThinkingLevelMap(source!.thinkingLevelMap),
		};

		const levels = getSupportedThinkingLevels(oauthModel);
		expect(levels).not.toContain("off");
		expect(levels).not.toContain("minimal");
		expect(levels).toContain("low");
		expect(getSupportedThinkingLevels(source!)).toContain("off");
	});
});
