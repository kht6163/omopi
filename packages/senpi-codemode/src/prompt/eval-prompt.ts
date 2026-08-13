export interface EnabledLanguages {
	readonly py: boolean;
	readonly js: boolean;
	readonly rb: boolean;
	readonly jl: boolean;
}

export interface EvalPromptParts {
	readonly description: string;
	readonly promptSnippet: string;
	readonly promptGuidelines: readonly string[];
}

export interface EvalPromptOptions {
	readonly spawns: boolean;
	readonly spawnDefaultAgent?: string;
	/** Preformatted host line (e.g. "darwin arm64 · Apple M5 Max · 18 cores"); enables the host-sizing note. */
	readonly hostLine?: string;
}

type ContextValue = string | boolean;
type Context = Readonly<Record<string, ContextValue>>;
type EvalPromptExample = {
	readonly caption: string;
	readonly language: keyof EnabledLanguages;
	readonly summary: string;
	readonly code: string;
};

// senpi ToolDefinition has no examples field, so description embeds the examples.
// ADAPTATION: payloads diverge from omp's json-config chain to teach batch read
// and in-kernel reduction while keeping the three-cell reuse narrative.
const REUSE_CHAIN_EXAMPLES = [
	{
		caption: "First call — set up once",
		language: "py",
		summary: "Count all TypeScript source files under src/ excluding tests",
		code: "from pathlib import Path\nfrom collections import Counter\nfiles = [p for p in Path('src').rglob('*.ts') if 'test' not in p.parts]\nprint(len(files))",
	},
	{
		caption: "Second call — reuse `files`, batch-read in one cell",
		language: "py",
		summary: "Find which files reference legacyClient so we know what to migrate",
		code: "hits = Counter()\nfor p in files:\n    hits[p.name] = read(p).count('legacyClient')\ndisplay({k: v for k, v in hits.items() if v})",
	},
	{
		caption: "Third call — reuse results, reduce them in-kernel",
		language: "py",
		summary: "Rank the files with the most legacyClient references",
		code: "display(hits.most_common(10))",
	},
] as const satisfies readonly EvalPromptExample[];

const EVAL_PROMPT_TEMPLATE = `Run one step of code in a persistent kernel.

<instruction>
**One eval call = one cell = one logical step.** State persists per language across separate eval calls and tool calls{{#if spawns}}, and \`task\` subagents{{/if}} — define helpers, datasets, and clients in one call, then later calls reuse them directly.

Work incrementally: imports in one call, define in the next, test, then use — each its own eval call. Re-run setup ONLY after \`reset\`, a kernel crash, or a \`NameError\`/\`ReferenceError\` proving the state is gone.

Use direct session tools by default. When several independent calls are known up front, issue them together in one assistant response; the host runs sibling calls in parallel. Do not wrap direct calls in eval just to batch them.

Use eval when code is the work: persistent computation, or iterating, branching, transforming, or reducing results in-kernel. Within such a cell, use \`parallel(thunks)\` for independent calls.
{{#if hostLine}}
Host: {{hostLine}} — cells execute here. Size \`parallel(thunks)\` pools to its cores; \`tool.<name>()\` shell commands must fit this platform, even when the code you are writing targets another machine.
{{/if}}

Fields:

- \`language\` — {{#if py}}\`"py"\` IPython kernel{{/if}}{{#ifAll py js}}, {{/ifAll}}{{#if js}}\`"js"\` persistent JavaScript VM{{/if}}{{#if rb}}{{#ifAny py js}}, {{/ifAny}}\`"rb"\` persistent Ruby kernel{{/if}}{{#if jl}}{{#ifAny py js rb}}, {{/ifAny}}\`"jl"\` persistent Julia kernel{{/if}}.
- \`code\` — cell body, verbatim. Newlines/quotes JSON-encoded; no fences, no headers.
- \`summary\` (REQUIRED for run) — ONE line in the USER'S conversational language stating WHAT this cell does and FOR WHAT PURPOSE (e.g. Korean conversation -> "src 전체에서 legacyClient 사용처 집계"); shown in the TUI while the cell runs; >80 chars is force-truncated.
- \`timeout\` (optional) — seconds. Raise only for heavy compute or long{{#if spawns}} non-agent{{/if}} tool calls.
- \`on_timeout\` (optional) — \`"detach"\` keeps pure computation running in interactive sessions (the default); \`"error"\` interrupts for deadline-sensitive work and is the print/json default.
- \`reset\` (optional) — wipe this language's kernel first.{{#ifAll py js}} Per-language: a \`py\` reset never touches the JS VM.{{/ifAll}}
- \`action\` (optional) — defaults to \`"run"\`. A detached cell returns its id: use \`eval({ action: "peek", cell_id })\` for buffered output/state or \`eval({ action: "stop", cell_id })\` to cancel it.

A detached cell keeps its language kernel busy while it finishes. Do not re-run a detached cell: the same-language busy error names its cell id and output tail; another language can continue. Completion arrives as one notification with the final value/error and buffered output. Stopping a cell interrupts its kernel; the stop result states whether kernel state survived or the kernel was restarted and its variables lost.

{{#if py}}Live event loop: use top-level \`await\` directly; \`asyncio.run(…)\` raises "cannot be called from a running event loop".{{/if}}
{{#if js}}JS runs under Node.js worker: top-level \`await\`/\`return\` work; \`fetch\`/\`Buffer\` available.{{/if}}
{{#if rb}}Ruby: synchronous; helper options are keyword args{{#if spawns}} (e.g. \`output("id", limit: 2)\`){{/if}}; the last expression auto-displays unless it is \`nil\`, an assignment, or a definition (like IRB).{{/if}}
{{#if jl}}Julia: synchronous; helper options are standard keyword args{{#if spawns}} (e.g. \`output("id", limit=2)\`){{/if}}; the last expression auto-displays unless it is an assignment or a definition (like the Julia REPL).{{/if}}
On error, fix and re-run only the failing step. State usually survives a normal error, but a timeout or stop may have restarted the kernel — its message says which. Before rebuilding state, check a sentinel (a variable you defined earlier); only re-establish what is actually gone, since blind re-runs duplicate side effects.
</instruction>

<prelude>
{{#ifAll py js}}Same helpers + arg order, both runtimes. Python: sync, options = trailing kwargs. JS: async/\`await\`able, options = ONE trailing object literal, never positional (extras throw).{{else}}{{#if py}}Sync; options = trailing kwargs.{{/if}}{{#if js}}Async/\`await\`able; options = ONE trailing object literal, never positional (extras throw).{{/if}}{{/ifAll}}{{#if rb}} Ruby: sync, options = trailing keyword args.{{/if}}{{#if jl}} Julia: sync, options = trailing keyword args.{{/if}}
\`\`\`
display(value) → None
    Cell output; figures/images/dataframes shown natively.
print(value, ...) → None
    Text output.
read(path, offset?=1, limit?=None) → str
    File as text; offset/limit are 1-indexed lines. Accepts \`local://…\`.
write(path, content) → str
    Write file (creates parents) → resolved path. \`local://…\` persists across turns/subagents.
env(key?=None, value?=None) → str | None | dict
    No args → full env dict; one → value of \`key\`; two → set \`key=value\`, return value.
{{#if spawns}}output(*ids, format?="raw", offset?=None, limit?=None) → str | dict | list[dict]
    Task/agent output by id. Reads immediately: running tasks return their status; \`format\` selects full (\`"raw"\`) or trailing (\`"tail"\`) output.
{{/if}}tool.<name>(args) → unknown
    Invoke any session tool; \`args\` = its parameter object.
tool_schema(name?) → dict
    Parameter schema of a tool without calling it; omit \`name\` to list tool names.
    Use it before calling a tool you have not called before — a failed call also
    returns the expected parameters, so fix the args and retry in the next cell
    instead of abandoning eval.
completion(prompt, model?="default", system?=None, schema?=None) → str | dict
    Oneshot, stateless (no history/tools). \`model\`: \`"smol"\` fast | \`"default"\` session | \`"slow"\` most capable. \`schema\` (JSON-Schema) → structured output, parsed object.
{{#if spawns}}agent(prompt, agent?="{{spawnDefaultAgent}}", model?=None, label?=None, schema?=None, handle?=False) → str | dict
    Run a subagent → final output. \`agent\` picks another discovered agent; omit it to use \`{{spawnDefaultAgent}}\`. \`schema\` as in completion(). Background via \`local://\` files named in the prompt. \`handle\` → DAG node dict { text, output, handle: \`agent://<id>\`, id, agent } (parsed under \`data\` when \`schema\` set).
{{#if js}}    JS: options are ONE trailing object — agent(prompt, { agent, schema, handle }).
{{/if}}{{/if}}parallel(thunks) → list
    Thunks through a bounded pool (wide as a \`task\` batch — don't pre-shrink), input order kept; returns when all finish, a throwing thunk propagates.
pipeline(items, ...stages) → list
    Map items through one-arg stages left-to-right, barrier between stages; stage 1 gets the item, later stages the previous result.
log(message) → None
    Progress line above the status tree.
phase(title) → None
    Phase grouping subsequent status lines.
\`\`\`
</prelude>
{{#if spawns}}
<dag>
Pipe handles through stage helpers to build a dependency graph — acyclic waves:
- **Name nodes.** Capture each \`agent(…, {{#if py}}handle=True{{/if}}{{#if js}}{ handle: true }{{/if}}{{#if jl}}handle=true{{/if}})\` result; carries \`handle\` (\`agent://<id>\`) + \`output\`.
- **Wire edges by reference.** Put an upstream node's \`handle\`/\`output\` in the dependent stage's prompt — large transcript never re-inlined. Bulk: \`write("local://<name>.md", …)\`, pass the URI.
- **\`pipeline(items, *stages)\` = staged waves**, barrier between stages (every item clears stage N before any enters N+1). **\`parallel(thunks)\` = one wave** of independent nodes.
- **Isolate failure.** A raising node re-raises the lowest-index error, aborts its wave; wrap risky nodes in try/except so a failure degrades only its dependent subtree, independent branches finish.
- **Acyclic only.** A node never waits on its own descendant.
</dag>
{{/if}}

<critical>
Prior top-level names (\`data\`, \`sessions\`, helpers, imports) survive into the next eval call — reuse them; NEVER re-import, re-require, or re-declare a helper. Re-read a file only if it may have changed since the last read.
</critical>`;

export function buildEvalPrompt(
	enabled: EnabledLanguages,
	options: EvalPromptOptions = { spawns: false },
): EvalPromptParts {
	if (!enabled.py && !enabled.js && !enabled.rb && !enabled.jl) {
		throw new Error("no kernels enabled for eval prompt");
	}
	const spawnDefaultAgent = options.spawnDefaultAgent ?? "task";
	const context: Context = {
		py: enabled.py,
		js: enabled.js,
		rb: enabled.rb,
		jl: enabled.jl,
		spawns: options.spawns,
		spawnDefaultAgent,
		hostLine: options.hostLine ?? "",
	};
	const examples = REUSE_CHAIN_EXAMPLES.filter((example) => enabled[example.language])
		.map((example) => {
			const call = { language: example.language, summary: example.summary, code: example.code };
			return `### ${example.caption}\n\`\`\`json\n${JSON.stringify(call, null, 2)}\n\`\`\``;
		})
		.join("\n\n");
	const description = [
		renderTemplate(EVAL_PROMPT_TEMPLATE, context)
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
		examples === "" ? "" : `<examples>\n${examples}\n</examples>`,
	]
		.filter((part) => part !== "")
		.join("\n\n");
	return {
		description,
		promptSnippet: "Run one incremental code cell in a persistent language kernel.",
		promptGuidelines: [
			"Use direct tools by default and issue known independent calls together; use eval only for persistent computation or when code must iterate, branch, transform, or reduce results.",
			"Use eval reset only when a language kernel must be wiped; reset is scoped to the selected language.",
		],
	};
}

function renderTemplate(template: string, context: Context): string {
	let index = 0;
	const [rendered, nextIndex] = renderUntil(template, context, index, []);
	index = nextIndex;
	if (index !== template.length) {
		throw new Error("unexpected template close tag");
	}
	return rendered;
}

function renderUntil(
	template: string,
	context: Context,
	start: number,
	stopTags: readonly string[],
): readonly [string, number, string?] {
	let rendered = "";
	let index = start;
	while (index < template.length) {
		const open = template.indexOf("{{", index);
		if (open < 0) {
			return [rendered + template.slice(index), template.length];
		}
		rendered += template.slice(index, open);
		const close = template.indexOf("}}", open + 2);
		if (close < 0) {
			throw new Error("unterminated template tag");
		}
		const tag = template.slice(open + 2, close).trim();
		index = close + 2;
		if (stopTags.includes(tag)) {
			return [rendered, index, tag];
		}
		if (tag.startsWith("#")) {
			const [block, nextIndex] = renderBlock(template, context, index, tag);
			rendered += block;
			index = nextIndex;
			continue;
		}
		if (tag.startsWith("/")) {
			throw new Error(`unexpected template close tag ${tag}`);
		}
		rendered += valueFor(tag, context);
	}
	return [rendered, index];
}

function renderBlock(template: string, context: Context, start: number, openTag: string): readonly [string, number] {
	const [kind, ...names] = openTag.slice(1).split(/\s+/);
	const closeTag = `/${kind}`;
	const [truthyText, afterTruthy, stopTag] = renderUntil(template, context, start, ["else", closeTag]);
	let falseyText = "";
	let end = afterTruthy;
	if (stopTag === "else") {
		const [elseText, afterElse, elseStop] = renderUntil(template, context, afterTruthy, [closeTag]);
		if (elseStop !== closeTag) {
			throw new Error(`missing close tag for ${kind}`);
		}
		falseyText = elseText;
		end = afterElse;
	} else if (stopTag !== closeTag) {
		throw new Error(`missing close tag for ${kind}`);
	}
	return [condition(kind, names, context) ? truthyText : falseyText, end];
}

function condition(kind: string, names: readonly string[], context: Context): boolean {
	if (kind === "if") {
		return names.length === 1 && Boolean(context[names[0]]);
	}
	if (kind === "ifAll") {
		return names.length > 0 && names.every((name) => Boolean(context[name]));
	}
	if (kind === "ifAny") {
		return names.length > 0 && names.some((name) => Boolean(context[name]));
	}
	throw new Error(`unknown template condition ${kind}`);
}

function valueFor(name: string, context: Context): string {
	const value = context[name];
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "boolean" || value === undefined) {
		return "";
	}
	return String(value);
}
