#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const FOREIGN_CLI_NAMES = ["omo", "pi", "senpi"];

function readJson(relativePath) {
	return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

describe("CLI invocation surface", () => {
	it("exposes only omopi from the monorepo root and coding-agent package", () => {
		// Given
		const rootPackage = readJson("package.json");
		const codingAgentPackage = readJson("packages/coding-agent/package.json");

		// Then
		assert.deepEqual(rootPackage.bin, {
			omopi: "packages/coding-agent/dist/cli.js",
		});
		assert.deepEqual(codingAgentPackage.bin, {
			omopi: "dist/cli.js",
		});
		for (const name of FOREIGN_CLI_NAMES) {
			assert.equal(Object.hasOwn(rootPackage.bin, name), false);
			assert.equal(Object.hasOwn(codingAgentPackage.bin, name), false);
		}
	});
});
