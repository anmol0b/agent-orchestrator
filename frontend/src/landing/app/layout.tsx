import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import { HomeScrollReset } from "@/components/HomeScrollReset";
import "../styles/globals.css";

const inter = Inter({
	subsets: ["latin"],
	display: "swap",
	variable: "--font-inter",
});

const plexMono = IBM_Plex_Mono({
	subsets: ["latin"],
	weight: ["400", "500", "600"],
	display: "swap",
	variable: "--font-plex-mono",
});

const description =
	"Mission control for a fleet of coding agents. Run Claude Code, Codex, Cursor and 20 more harnesses in isolated git worktrees - AO watches every PR and routes CI and review feedback back to the agent that owns the branch.";

export const metadata: Metadata = {
	metadataBase: new URL("https://aoagents.dev"),
	title: "Agent Orchestrator - Mission control for coding agents",
	description: "Mission control for a fleet of coding agents. Open source, runs locally on your machine.",
	openGraph: {
		type: "website",
		url: "https://aoagents.dev/",
		siteName: "Agent Orchestrator",
		title: "Agent Orchestrator - Mission control for coding agents",
		description,
		images: [{ url: "/og-image.png", width: 1024, height: 1024, alt: "Agent Orchestrator" }],
	},
	twitter: {
		card: "summary",
		site: "@aoagents",
		creator: "@aoagents",
		title: "Agent Orchestrator - Mission control for coding agents",
		description,
		images: ["/og-image.png"],
	},
};

const themeScript = `
(() => {
  document.documentElement.dataset.theme = "dark";
  document.documentElement.classList.add("dark");
  document.documentElement.style.colorScheme = "dark";
  if (new URLSearchParams(window.location.search).get("mode") === "machine") {
    document.documentElement.dataset.mode = "machine";
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html
			lang="en"
			suppressHydrationWarning
			className={`${inter.variable} ${plexMono.variable} ${inter.className} dark`}
			data-theme="dark"
			style={{ colorScheme: "dark" }}
		>
			<head>
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
			</head>
			<body className={`${inter.variable} ${plexMono.variable} ${inter.className} font-sans`}>
				<HomeScrollReset />
				{children}
			</body>
		</html>
	);
}
