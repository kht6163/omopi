import { type Component, Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

/**
 * Thinking body: gray + italic prose with a left quote border so it is
 * visually distinct from the assistant answer (which shares the same pad).
 */
export class ThinkingBodyComponent implements Component {
	private readonly markdown: Markdown;
	private readonly paddingX: number;

	constructor(
		text: string,
		paddingX: number,
		markdownTheme: MarkdownTheme,
		isStreaming = false,
		markdownTransformers: readonly MarkdownTransformer[] = [],
	) {
		this.paddingX = Math.max(0, paddingX);
		// Content itself is not left-padded; we add pad + "│ " per line in render().
		this.markdown = new Markdown(
			text,
			0,
			0,
			markdownTheme,
			{
				color: (chunk: string) => theme.fg("thinkingText", chunk),
				italic: true,
			},
			{
				transform: createMarkdownTransform("assistant-thinking", isStreaming, markdownTransformers),
			},
		);
	}

	setText(text: string): void {
		this.markdown.setText(text);
	}

	invalidate(): void {
		this.markdown.invalidate();
	}

	render(width: number): string[] {
		const pad = " ".repeat(this.paddingX);
		const border = theme.fg("thinkingText", "│ ");
		const prefix = pad + border;
		// Border is 2 visible columns ("│ "); reserve that plus padding.
		const contentWidth = Math.max(1, width - this.paddingX - 2);
		return this.markdown.render(contentWidth).map((line) => prefix + line);
	}
}
