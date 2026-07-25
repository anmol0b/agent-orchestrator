function ArrowDown({ className = "" }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
			<path d="M12 4v14" />
			<path d="m6 12 6 6 6-6" />
		</svg>
	);
}

function ArrowRight({ className = "" }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
			<path d="M4 12h14" />
			<path d="m12 6 6 6-6 6" />
		</svg>
	);
}

function BoundaryNode({
	title,
	detail,
	accent = false,
}: {
	title: string;
	detail: string;
	accent?: boolean;
}) {
	return (
		<div
			className={`w-full rounded-md border px-4 py-3 text-left ${
				accent
					? "border-[color:var(--status-ready)] bg-[color:var(--status-ready-soft)]"
					: "border-[color:var(--border-strong)] bg-[color:var(--bg-card)]"
			}`}
		>
			<div className="text-[13.5px] font-semibold text-[color:var(--fg)]">{title}</div>
			<div className="mt-0.5 font-mono text-[10.5px] leading-relaxed tracking-[0.02em] text-[color:var(--fg-dim)]">
				{detail}
			</div>
		</div>
	);
}

function OutsideNode({
	title,
	detail,
	egress,
	crossed = false,
}: {
	title: string;
	detail: string;
	egress: string;
	crossed?: boolean;
}) {
	return (
		<div
			className={`rounded-md border px-4 py-3 ${
				crossed
					? "border-dashed border-[color:var(--border-strong)] bg-transparent opacity-70"
					: "border-[color:var(--border)] bg-[color:var(--bg-card)]"
			}`}
		>
			<div className="flex items-baseline justify-between gap-3">
				<span className={`text-[13.5px] font-semibold ${crossed ? "text-[color:var(--fg-dim)] line-through" : "text-[color:var(--fg)]"}`}>
					{title}
				</span>
				{crossed ? (
					<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--status-fail)]">
						does not exist
					</span>
				) : null}
			</div>
			<div className="mt-0.5 font-mono text-[10.5px] leading-relaxed tracking-[0.02em] text-[color:var(--fg-dim)]">
				{detail}
			</div>
			<div className="mt-2 border-t border-[color:var(--border)] pt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--status-action)]">
				{egress}
			</div>
		</div>
	);
}

const facts = [
	{
		title: "No account",
		body: "There is nothing to sign up for. Download, run, done.",
	},
	{
		title: "No AO cloud",
		body: "The daemon on 127.0.0.1 is the entire backend. Nothing to phone home to.",
	},
	{
		title: "No AO-issued tokens",
		body: "Auth is your gh auth login. AO reads issues, PRs, and CI as you.",
	},
	{
		title: "Everything in ~/.ao",
		body: "Daemon state, session metadata, and worktrees live on your disk.",
	},
];

export function LandingLocalFirst() {
	return (
		<section
			id="local-first"
			data-testid="local-first-section"
			className="landing-section landing-reveal relative border-t border-[color:var(--border)]"
		>
			<div className="container-page">
				<div className="mx-auto max-w-[1180px]">
					<div className="max-w-[720px]">
						<div className="landing-eyebrow mb-4 text-[color:var(--status-ready)]">Local-first</div>
						<h2 className="landing-heading">
							Your code never <span className="landing-heading-muted">leaves localhost.</span>
						</h2>
						<p className="landing-body-compact mt-5">
							AO has no account system and no cloud. The only traffic off your machine is traffic you already have:
							<code className="font-mono text-[0.9em] text-[color:var(--fg)]"> gh </code> talking to GitHub, and your
							agent CLIs talking to their model providers.
						</p>
					</div>

					{/* Trust-boundary diagram */}
					<div className="mt-14 grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_120px_minmax(0,300px)]">
						{/* Inside the boundary */}
						<div className="relative rounded-lg border border-dashed border-[color:var(--status-ready)] bg-[color:var(--status-ready-soft)]/40 px-6 pb-6 pt-9 sm:px-8">
							<span className="absolute -top-2.5 left-5 bg-[color:var(--bg)] px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--status-ready)]">
								Your machine · trust boundary
							</span>
							<div className="flex h-full flex-col items-center justify-center gap-3">
								<div className="grid w-full gap-3 sm:grid-cols-2">
									<BoundaryNode title="Desktop app" detail="Electron supervisor · board, terminals, inspector" />
									<BoundaryNode title="ao CLI" detail="thin client over the daemon HTTP API" />
								</div>
								<ArrowDown className="h-4 w-4 shrink-0 text-[color:var(--fg-dim)]" />
								<BoundaryNode
									accent
									title="AO daemon"
									detail="127.0.0.1 only · HTTP + SSE · SQLite in ~/.ao · loopback, no auth"
								/>
								<ArrowDown className="h-4 w-4 shrink-0 text-[color:var(--fg-dim)]" />
								<BoundaryNode
									title="Worker sessions"
									detail="one git worktree + one runtime (tmux/process) + one agent CLI per task"
								/>
							</div>
						</div>

						{/* Egress arrows (desktop only) */}
						<div className="hidden flex-col items-center justify-center gap-16 lg:flex" aria-hidden="true">
							<div className="flex flex-col items-center gap-1.5 text-[color:var(--fg-dim)]">
								<span className="font-mono text-[9.5px] uppercase tracking-[0.14em]">egress</span>
								<ArrowRight className="h-4 w-full" />
							</div>
							<div className="flex flex-col items-center gap-1.5 text-[color:var(--fg-dim)]">
								<span className="font-mono text-[9.5px] uppercase tracking-[0.14em]">egress</span>
								<ArrowRight className="h-4 w-full" />
							</div>
						</div>

						{/* Outside the boundary */}
						<div className="flex flex-col justify-center gap-3">
							<OutsideNode
								title="GitHub"
								detail="issues · PRs · checks · reviews"
								egress="gh api — your token"
							/>
							<OutsideNode
								title="Model providers"
								detail="Anthropic · OpenAI · Google · …"
								egress="agent CLIs — your subscriptions"
							/>
							<OutsideNode
								crossed
								title="AO control plane"
								detail="no hosted backend · no telemetry pipeline · no token broker"
								egress="nothing to connect"
							/>
						</div>
					</div>

					{/* Fact row */}
					<div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--border)] sm:grid-cols-2 lg:grid-cols-4">
						{facts.map((fact) => (
							<div key={fact.title} className="bg-[color:var(--bg-card)] px-5 py-5">
								<div className="flex items-center gap-2">
									<span className="h-1 w-1 rounded-full bg-[color:var(--status-ready)]" />
									<span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--fg)]">
										{fact.title}
									</span>
								</div>
								<p className="mt-2.5 text-[13px] leading-[1.6] text-[color:var(--fg-muted)]">{fact.body}</p>
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}
