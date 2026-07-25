"use client";

import { useGitHubRepoFacts } from "../lib/use-github-repo-facts";

const REPO_URL = "https://github.com/AgentWrapper/agent-orchestrator";
const RELEASES_URL = `${REPO_URL}/releases`;
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
const HARNESSES_URL = "/docs/plugins/agents/";

export function LandingStatStrip() {
	const { stars, latestRelease } = useGitHubRepoFacts();

	const stats = [
		{
			value: stars ?? "8.6k",
			label: "GitHub stars",
			href: `${REPO_URL}/stargazers`,
		},
		{
			value: "23",
			label: "agent harnesses",
			href: HARNESSES_URL,
		},
		{
			value: "Apache-2.0",
			label: "license",
			href: LICENSE_URL,
		},
		{
			value: "Daily",
			label: latestRelease ? `nightly builds · latest ${latestRelease}` : "nightly builds",
			href: RELEASES_URL,
		},
	];

	return (
		<section data-testid="stat-strip" className="relative border-b border-[color:var(--border)]">
			<div className="container-page">
				<div className="mx-auto max-w-[1180px]">
					<div className="grid grid-cols-2 lg:grid-cols-4">
						{stats.map((stat, index) => (
							<a
								key={stat.label}
								href={stat.href}
								target={stat.href.startsWith("http") ? "_blank" : undefined}
								rel={stat.href.startsWith("http") ? "noreferrer" : undefined}
								className={`group flex flex-col gap-2 py-9 pr-6 sm:py-11 ${index > 0 ? "pl-6 sm:pl-8" : ""} ${
									index > 0 ? "border-l border-[color:var(--border)]" : ""
								} ${index === 2 ? "max-lg:border-l-0 max-lg:border-t max-lg:border-[color:var(--border)]" : ""} ${
									index === 3 ? "max-lg:border-t max-lg:border-[color:var(--border)]" : ""
								}`}
							>
								<span className="text-[26px] font-semibold leading-none tracking-[-0.02em] text-[color:var(--fg)] transition-colors group-hover:text-[color:var(--accent)] sm:text-[30px]">
									{stat.value}
								</span>
								<span className="font-mono text-[10.5px] uppercase leading-relaxed tracking-[0.14em] text-[color:var(--fg-dim)]">
									{stat.label}
								</span>
							</a>
						))}
					</div>
					<p className="border-t border-[color:var(--border)] py-5 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--fg-dim)]">
						Built by{" "}
						<a
							href={REPO_URL}
							target="_blank"
							rel="noreferrer"
							className="text-[color:var(--fg-muted)] underline decoration-[color:var(--border-strong)] underline-offset-4 transition-colors hover:text-[color:var(--fg)]"
						>
							AgentWrapper
						</a>{" "}
						and open-source contributors
					</p>
				</div>
			</div>
		</section>
	);
}
