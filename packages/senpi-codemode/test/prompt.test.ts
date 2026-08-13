import { describe, expect, it } from "vitest";
import { buildEvalPrompt } from "../src/prompt/eval-prompt.ts";

type PromptOptions = {
	readonly spawns: boolean;
	readonly spawnDefaultAgent?: string;
};

const forbiddenPromptTokens = ["budget", "+Nk", "PI_", "artifact://", "Bun"] as const;
const coreHelperNames = [
	"display(value)",
	"print(value",
	"read(path",
	"write(path",
	"env(key",
	"tool.<name>(args)",
	"completion(prompt",
	"parallel(thunks)",
	"pipeline(items",
	"log(message)",
	"phase(title)",
] as const;

function fullPrompt(
	enabled: {
		readonly py: boolean;
		readonly js: boolean;
		readonly rb: boolean;
		readonly jl: boolean;
	},
	options: PromptOptions = { spawns: false },
): string {
	const prompt = buildEvalPrompt(enabled, options);
	return [prompt.description, prompt.promptSnippet ?? "", ...prompt.promptGuidelines].join("\n");
}

describe("buildEvalPrompt", () => {
	it.each([
		["js without spawns", { py: false, js: true, rb: false, jl: false }, { spawns: false }],
		["js-py without spawns", { py: true, js: true, rb: false, jl: false }, { spawns: false }],
		["all with spawns", { py: true, js: true, rb: true, jl: true }, { spawns: true, spawnDefaultAgent: "task" }],
	] as const)("renders the %s prompt", (_name, enabled, options) => {
		// Given: an enabled language set and its task-tool availability.
		// When: the eval prompt is built.
		// Then: its complete user-facing contract remains snapshotted.
		expect(buildEvalPrompt(enabled, options)).toMatchSnapshot();
	});

	it("documents only enabled language fields and reset scope", () => {
		const prompt = fullPrompt({ py: true, js: true, rb: false, jl: false });

		expect(prompt).toContain('`"py"` IPython kernel');
		expect(prompt).toContain('`"js"` persistent JavaScript VM');
		expect(prompt).not.toContain('`"rb"` persistent Ruby kernel');
		expect(prompt).not.toContain('`"jl"` persistent Julia kernel');
		expect(prompt).toContain("a `py` reset never touches the JS VM");
	});

	it("omits disabled and missing languages from the prompt", () => {
		const prompt = fullPrompt({ py: false, js: true, rb: false, jl: false });

		expect(prompt).toContain('`"js"` persistent JavaScript VM');
		expect(prompt).not.toContain('`"py"` IPython kernel');
		expect(prompt).not.toContain('`"rb"` persistent Ruby kernel');
		expect(prompt).not.toContain('`"jl"` persistent Julia kernel');
	});

	it("gates spawn helpers and the DAG on task-tool availability", () => {
		// Given: the same Python/Node kernel pair with and without a task tool.
		const enabled = { py: true, js: true, rb: false, jl: false };
		// When: the descriptions are built for both availability states.
		const withoutSpawns = buildEvalPrompt(enabled, { spawns: false }).description;
		const withSpawns = buildEvalPrompt(enabled, { spawns: true, spawnDefaultAgent: "researcher" }).description;

		// Then: task-only helpers and the DAG are exposed only when callable.
		expect(withoutSpawns).not.toContain("agent(");
		expect(withoutSpawns).not.toContain("output(*ids");
		expect(withoutSpawns).not.toContain("<dag>");
		expect(withSpawns).toContain('agent(prompt, agent?="researcher"');
		expect(withSpawns).toContain('output(*ids, format?="raw"');
		expect(withSpawns).toContain("<dag>");
		expect(withSpawns).toContain("omit it to use `researcher`");
	});

	it("filters reuse-chain examples by enabled language", () => {
		// Given: prompts exposing the Python example set and kernels without one.
		const python = buildEvalPrompt({ py: true, js: false, rb: false, jl: false }, { spawns: false }).description;
		const ruby = buildEvalPrompt({ py: false, js: false, rb: true, jl: false }, { spawns: false }).description;
		const node = buildEvalPrompt({ py: false, js: true, rb: false, jl: false }, { spawns: false }).description;

		// When: their embedded reuse-chain examples are rendered.
		// Then: only Python kernels carry examples, and those teach persistent in-kernel reduction.
		expect(python).toContain("Count all TypeScript source files under src/ excluding tests");
		expect(python).toContain("most_common");
		expect(python).not.toContain("tool.grep");
		expect(ruby).not.toContain("<examples>");
		expect(node).not.toContain("<examples>");
	});

	it("documents core helpers with Node wording and no excluded surface", () => {
		const prompt = fullPrompt({ py: true, js: true, rb: true, jl: true });

		for (const helperName of coreHelperNames) {
			expect(prompt).toContain(helperName);
		}
		expect(prompt).toContain("Node.js worker");
		for (const token of forbiddenPromptTokens) {
			expect(prompt).not.toContain(token);
		}
	});

	it("documents timeout detachment, busy-kernel discipline, and detached-cell controls", () => {
		const prompt = fullPrompt({ py: true, js: true, rb: false, jl: false });

		expect(prompt).toContain("`on_timeout`");
		expect(prompt).toContain('eval({ action: "peek", cell_id })');
		expect(prompt).toContain('eval({ action: "stop", cell_id })');
		expect(prompt).toContain("Do not re-run a detached cell");
	});

	it("teaches output() as an immediate status or transcript read", () => {
		const prompt = fullPrompt({ py: true, js: true, rb: false, jl: false }, { spawns: true });

		expect(prompt).toContain("Reads immediately: running tasks return their status");
	});

	it("keeps eval-specific prompt guidelines stable", () => {
		// Given: a registered eval tool.
		// When: its prompt metadata is built.
		const guidelines = buildEvalPrompt({ py: true, js: true, rb: true, jl: true }, { spawns: true }).promptGuidelines;

		// Then: direct tools stay the default and eval is reserved for code-shaped work.
		expect(guidelines).toEqual([
			"Use direct tools by default and issue known independent calls together; use eval only for persistent computation or when code must iterate, branch, transform, or reduce results.",
			"Use eval reset only when a language kernel must be wiped; reset is scoped to the selected language.",
		]);
	});

	it("keeps direct tool calls native and reserves eval for code-shaped work", () => {
		const prompt = buildEvalPrompt({ py: true, js: true, rb: false, jl: false }, { spawns: false }).description;

		expect(prompt).toContain("Use direct session tools by default");
		expect(prompt).toContain("issue them together in one assistant response");
		expect(prompt).toContain("Do not wrap direct calls in eval just to batch them");
		expect(prompt).toContain("persistent computation");
		expect(prompt).toContain("iterating, branching, transforming, or reducing results in-kernel");
		expect(prompt).not.toContain("EVAL FIRST");
		expect(prompt).not.toContain("default execution surface");
		expect(prompt).not.toContain("PRIMARY EXECUTION SURFACE");
	});

	it("renders the host-sizing note only when a host line is provided", () => {
		// Given: the same kernel set with and without a preformatted host line.
		const enabled = { py: true, js: true, rb: false, jl: false };
		const withHost = buildEvalPrompt(enabled, {
			spawns: false,
			hostLine: "darwin arm64 \u00b7 Apple M5 Max \u00b7 18 cores",
		}).description;
		const withoutHost = buildEvalPrompt(enabled, { spawns: false }).description;

		// Then: the note names the host and the sizing rule, and disappears without one.
		expect(withHost).toContain("Host: darwin arm64 \u00b7 Apple M5 Max \u00b7 18 cores — cells execute here.");
		expect(withHost).toContain("Size `parallel(thunks)` pools to its cores");
		expect(withoutHost).not.toContain("Host:");
	});

	it("throws when no kernels are enabled", () => {
		expect(() => buildEvalPrompt({ py: false, js: false, rb: false, jl: false })).toThrow(/no kernels enabled/i);
	});
});
