"use client";

import type { CanvasArtifact } from "@aoagents/ao-core";

type Props = { canvas: Extract<CanvasArtifact, { type: "markdown" }> };

export function MarkdownCanvas({ canvas }: Props) {
  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-[var(--color-text-primary)]">
      {canvas.payload.markdown}
    </pre>
  );
}
