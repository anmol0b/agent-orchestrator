"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Types `text` character-by-character the first time the host element scrolls
 * into view (IntersectionObserver, once), like real tty output. Returns the
 * host ref, the text to display right now, and whether typing is in progress
 * (so callers can show a blinking caret only while typing).
 *
 * Reduced-motion users always get the full text immediately, and server/first
 * paint renders the full text — typing only starts after mount when motion is
 * allowed.
 */
export function useTypedOnView(text: string, intervalMs = 18) {
	const hostRef = useRef<HTMLElement | null>(null);
	const [count, setCount] = useState(text.length);
	const [typing, setTyping] = useState(false);

	useLayoutEffect(() => {
		const el = hostRef.current;
		if (!el) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

		setCount(0);
		let interval: number | undefined;
		const io = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				io.disconnect();
				setTyping(true);
				let n = 0;
				interval = window.setInterval(() => {
					n += 1;
					setCount(n);
					if (n >= text.length) {
						window.clearInterval(interval);
						interval = undefined;
						setTyping(false);
					}
				}, intervalMs);
			},
			{ threshold: 0.3 },
		);
		io.observe(el);

		return () => {
			io.disconnect();
			if (interval !== undefined) window.clearInterval(interval);
		};
	}, [text, intervalMs]);

	return { hostRef, display: text.slice(0, count), typing };
}
