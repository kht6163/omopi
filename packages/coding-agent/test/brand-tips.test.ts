import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { APP_NAME, agentDirLabel, CONFIG_DIR_NAME } from "../src/config.ts";

const CATALOG_URL = new URL("../src/modes/interactive/tips/catalog/", import.meta.url);
const HELP_URL = new URL("../src/core/extensions/builtin/help/index.ts", import.meta.url);

function catalogSources(): Array<{ file: string; source: string }> {
	return readdirSync(CATALOG_URL)
		.filter((file) => file.endsWith("-tips.ts"))
		.map((file) => ({ file, source: readFileSync(new URL(file, CATALOG_URL), "utf-8") }));
}

describe("tips and help text", () => {
	test("no catalog file hardcodes the product name or its config directory", () => {
		for (const { file, source } of catalogSources()) {
			expect({ file, hit: /\b(senpi|omopi)\b/i.test(source) }).toEqual({ file, hit: false });
		}
	});

	test("help text names the running product instead of a fixed brand", () => {
		const help = readFileSync(HELP_URL, "utf-8");
		expect(/\bsenpi\b/i.test(help)).toBe(false);
		expect(/\bomopi\b/i.test(help)).toBe(false);
	});

	test("a standalone install still reads as omopi", () => {
		expect(APP_NAME).toBe("omopi");
		expect(CONFIG_DIR_NAME).toBe(".omopi");
		expect(agentDirLabel()).toBe("~/.omopi/agent");
	});
});
