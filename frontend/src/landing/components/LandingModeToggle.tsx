"use client";

import { useEffect, useState } from "react";

/**
 * HUMAN / MACHINE switch (parallel.ai pattern). The active state lives on
 * <html data-mode="machine"> so CSS owns the swap — no re-render, no reload.
 * The URL carries ?mode=machine so the spec view is directly linkable.
 */
export function LandingModeToggle() {
	// null until mounted: SSR renders both buttons unpressed, then we sync from
	// the attribute the inline head script may already have set.
	const [mode, setMode] = useState<"human" | "machine" | null>(null);

	useEffect(() => {
		setMode(document.documentElement.dataset.mode === "machine" ? "machine" : "human");
	}, []);

	function apply(next: "human" | "machine") {
		const root = document.documentElement;
		const url = new URL(window.location.href);
		if (next === "machine") {
			root.dataset.mode = "machine";
			url.searchParams.set("mode", "machine");
		} else {
			delete root.dataset.mode;
			url.searchParams.delete("mode");
		}
		window.history.replaceState(null, "", url);
		window.scrollTo({ top: 0, left: 0, behavior: "instant" });
		setMode(next);
	}

	return (
		<div
			data-testid="mode-toggle"
			className="mode-toggle fixed right-4 top-[88px] z-50 md:right-6 xl:top-6"
			role="group"
			aria-label="Page mode"
		>
			<div className="flex items-center rounded-full border border-[color:var(--border-strong)] bg-[#0a0b0d]/85 p-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] shadow-lg backdrop-blur-md">
				<button
					type="button"
					data-mode-btn="human"
					aria-pressed={mode === null ? undefined : mode === "human"}
					onClick={() => apply("human")}
					className="mode-toggle-btn rounded-full px-3 py-1.5 transition-colors"
				>
					Human
				</button>
				<button
					type="button"
					data-mode-btn="machine"
					aria-pressed={mode === null ? undefined : mode === "machine"}
					onClick={() => apply("machine")}
					className="mode-toggle-btn rounded-full px-3 py-1.5 transition-colors"
				>
					Machine
				</button>
			</div>
		</div>
	);
}
