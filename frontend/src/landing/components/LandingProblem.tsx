type Comparison = {
	without: string;
	with: string;
};

const rows: Comparison[] = [
	{
		without: "Six terminals, six agents. You alt-tab through them to find the one that's stuck.",
		with: "One board. Every session shows its agent, branch, PR, and CI state.",
	},
	{
		without: "CI fails at 2:14 PM. You notice at 6 PM, when you happen to check that tab.",
		with: "A failed check routes straight back to the agent that owns the branch. It fixes and re-pushes.",
	},
	{
		without: "A review comment sits unread. By the time you paste it in, the agent has lost the context.",
		with: "Review comments land in the session that owns the PR, while the context is still warm.",
	},
	{
		without: "Two agents edit the same checkout. You spend the morning untangling the conflict.",
		with: "Every worker gets its own git worktree. No shared checkout, no cross-talk.",
	},
	{
		without: "Four PRs are open. Which one needs you? You click through all four to find out.",
		with: "The Needs you column collects everything waiting on a human. Ignore the rest.",
	},
];

function CrossIcon({ className = "" }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
			<path d="M18 6 6 18" />
			<path d="m6 6 12 12" />
		</svg>
	);
}

function CheckIcon({ className = "" }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
			<path d="m4 12.5 5 5L20 6.5" />
		</svg>
	);
}

export function LandingProblem() {
	return (
		<section
			id="problem"
			data-testid="problem-section"
			className="landing-section landing-reveal relative border-t border-[color:var(--border)]"
		>
			<div className="container-page">
				<div className="mx-auto max-w-[1180px]">
					<div className="max-w-[720px]">
						<div className="landing-eyebrow mb-4">The problem</div>
						<h2 className="landing-heading">
							Agents are easy to start. <span className="landing-heading-muted">They're hard to supervise.</span>
						</h2>
						<p className="landing-body-compact mt-5">
							The bottleneck isn't getting an agent to write code. It's knowing what ten of them are doing — and
							noticing the one that needs you before its context goes cold.
						</p>
					</div>

					<div className="mt-14 grid gap-4 lg:grid-cols-2">
						{/* Without AO */}
						<div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-card)]">
							<div className="flex items-center gap-2.5 border-b border-[color:var(--border)] px-6 py-4">
								<span className="h-1.5 w-1.5 rounded-full bg-[color:var(--status-fail)]" />
								<span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--status-fail)]">
									Without AO
								</span>
							</div>
							<ul className="flex flex-col divide-y divide-[color:var(--border)]">
								{rows.map((row) => (
									<li key={row.without} className="flex items-start gap-3.5 px-6 py-5">
										<CrossIcon className="mt-1 h-3.5 w-3.5 shrink-0 text-[color:var(--status-fail)]" />
										<p className="text-[14.5px] leading-[1.65] text-[color:var(--fg-muted)]">{row.without}</p>
									</li>
								))}
							</ul>
						</div>

						{/* With AO */}
						<div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-card)]">
							<div className="flex items-center gap-2.5 border-b border-[color:var(--border)] px-6 py-4">
								<span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[color:var(--status-ready)]" />
								<span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--status-ready)]">
									With AO
								</span>
							</div>
							<ul className="flex flex-col divide-y divide-[color:var(--border)]">
								{rows.map((row) => (
									<li key={row.with} className="flex items-start gap-3.5 px-6 py-5">
										<CheckIcon className="mt-1 h-3.5 w-3.5 shrink-0 text-[color:var(--status-ready)]" />
										<p className="text-[14.5px] leading-[1.65] text-[color:var(--fg)]">{row.with}</p>
									</li>
								))}
							</ul>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
