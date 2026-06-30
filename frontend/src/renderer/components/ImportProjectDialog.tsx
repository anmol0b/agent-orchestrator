import * as Dialog from "@radix-ui/react-dialog";
import {
	ArrowLeft,
	CheckCircle2,
	Folder,
	FolderPlus,
	GitBranch,
	Package,
	RefreshCw,
	X,
	XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { aoBridge } from "../lib/bridge";
import { cn } from "../lib/utils";
import type { ImportFolderMode, ImportFolderScan } from "../../preload";
import { Button } from "./ui/button";
import { RequiredAgentField, type CreateProjectAgentSelection } from "./CreateProjectAgentSheet";

export type ImportProjectInput = CreateProjectAgentSelection & {
	path: string;
	asWorkspace: boolean;
};

type ImportProjectDialogProps = {
	error?: string | null;
	isImporting: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: ImportProjectInput) => Promise<void>;
	open: boolean;
};

type ImportMode = ImportFolderMode;

type ImportCardProps = {
	active?: boolean;
	"aria-label": string;
	children: React.ReactNode;
	onClick: () => void;
};

function ImportCard({ active = false, children, onClick, "aria-label": ariaLabel }: ImportCardProps) {
	return (
		<button
			type="button"
			aria-label={ariaLabel}
			onClick={onClick}
			className={cn(
				"flex min-h-[184px] flex-col rounded-lg border border-border bg-background/70 p-4 text-left transition-colors",
				"hover:border-border-strong hover:bg-surface",
				active && "border-accent-dim bg-accent-weak/20",
			)}
		>
			{children}
		</button>
	);
}

function displayPath(path: string) {
	return path.replace(/^\/Users\/([^/]+)/, "~");
}

function remoteHost(remote: string) {
	const sshMatch = remote.match(/^[^@]+@([^:/]+)[:/]/);
	if (sshMatch?.[1]) return sshMatch[1];
	try {
		return new URL(remote).host;
	} catch {
		return remote.replace(/^https?:\/\//, "").split(/[/:]/)[0] || remote;
	}
}

export function ImportProjectDialog({ error, isImporting, onOpenChange, onSubmit, open }: ImportProjectDialogProps) {
	const [mode, setMode] = useState<ImportMode | null>(null);
	const [scan, setScan] = useState<ImportFolderScan | null>(null);
	const [scanError, setScanError] = useState<string | null>(null);
	const [isChoosing, setIsChoosing] = useState(false);
	const [workerAgent, setWorkerAgent] = useState("");
	const [orchestratorAgent, setOrchestratorAgent] = useState("");

	useEffect(() => {
		if (!open) {
			setMode(null);
			setScan(null);
			setScanError(null);
			setWorkerAgent("");
			setOrchestratorAgent("");
		}
	}, [open]);

	const failedRepos = useMemo(() => scan?.repos.filter((repo) => !repo.hasRemote) ?? [], [scan]);
	const selectedPath = scan?.path ?? null;
	const hasAgents = workerAgent !== "" && orchestratorAgent !== "";
	const repoCount = scan?.repos.length ?? 0;
	const workspaceReady = mode === "workspace" && !!selectedPath && repoCount > 0 && failedRepos.length === 0;
	const projectReady = mode === "project" && !!selectedPath && repoCount === 1;
	const canImport = hasAgents && !isImporting && (workspaceReady || projectReady);

	const chooseFolder = async (nextMode = mode) => {
		if (!nextMode) return;
		setScanError(null);
		setIsChoosing(true);
		try {
			const title =
				nextMode === "workspace" ? "Choose a folder that contains your Git repositories" : "Choose a project folder";
			const path = await aoBridge.app.chooseDirectory(title);
			if (!path) return;
			const result = await aoBridge.app.scanImportFolder({ path, mode: nextMode });
			setScan(result);
		} catch (err) {
			setScan(null);
			setScanError(err instanceof Error ? err.message : "Could not inspect selected folder");
		} finally {
			setIsChoosing(false);
		}
	};

	const selectMode = (nextMode: ImportMode) => {
		setMode(nextMode);
		setScan(null);
		setScanError(null);
	};

	const backToTypePicker = () => {
		setMode(null);
		setScan(null);
		setScanError(null);
		setWorkerAgent("");
		setOrchestratorAgent("");
	};

	const submit = async () => {
		if (!canImport || !selectedPath || !mode) return;
		await onSubmit({
			path: selectedPath,
			asWorkspace: mode === "workspace",
			workerAgent,
			orchestratorAgent,
		});
	};

	return (
		<Dialog.Root open={open} onOpenChange={(next) => !isImporting && onOpenChange(next)}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 data-[state=open]:animate-overlay-in" />
				<Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(760px,calc(100vh-40px))] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-xl data-[state=open]:animate-modal-in">
					{mode === null ? (
						<div className="flex flex-col">
							<div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
								<div>
									<Dialog.Title className="text-[15px] font-semibold text-foreground">
										Import to Agent Orchestrator
									</Dialog.Title>
									<Dialog.Description className="mt-1 text-[12px] text-muted-foreground">
										Choose whether to import a workspace or a single project.
									</Dialog.Description>
								</div>
								<Dialog.Close asChild>
									<button
										type="button"
										className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-surface hover:text-foreground"
										aria-label="Close import dialog"
									>
										<X className="size-4" aria-hidden="true" />
									</button>
								</Dialog.Close>
							</div>
							<div className="grid gap-3 p-5 sm:grid-cols-2">
								<ImportCard aria-label="Workspace" onClick={() => selectMode("workspace")}>
									<div className="mb-5 rounded-md border border-border bg-surface p-3">
										<div className="flex items-center gap-2 text-[12px] text-muted-foreground">
											<Folder className="size-4 text-accent" aria-hidden="true" />
											<span className="font-medium text-foreground">workspace</span>
										</div>
										<div className="mt-3 grid gap-1.5 pl-5">
											{["web-app", "api-server", "shared-libs"].map((name) => (
												<span key={name} className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground">
													{name}
												</span>
											))}
										</div>
									</div>
									<div className="mt-auto">
										<div className="text-[14px] font-semibold text-foreground">Workspace</div>
										<p className="mt-1 text-[12px] leading-5 text-muted-foreground">
											Several Git repos that live under one parent folder
										</p>
										<div className="mt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-passive">
											• Multiple repositories
										</div>
									</div>
								</ImportCard>
								<ImportCard aria-label="Project" onClick={() => selectMode("project")}>
									<div className="mb-5 rounded-md border border-border bg-surface p-3">
										<div className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
											<GitBranch className="size-3.5 text-accent" aria-hidden="true" />
											web-app · main
										</div>
									</div>
									<div className="mt-auto">
										<div className="text-[14px] font-semibold text-foreground">Project</div>
										<p className="mt-1 text-[12px] leading-5 text-muted-foreground">A single Git repository</p>
										<div className="mt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-passive">
											• One repository
										</div>
									</div>
								</ImportCard>
							</div>
						</div>
					) : (
						<div className="flex min-h-0 flex-1 flex-col">
							<div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
								<div className="flex min-w-0 items-start gap-3">
									<button
										type="button"
										className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-surface hover:text-foreground disabled:opacity-50"
										onClick={backToTypePicker}
										disabled={isImporting}
										aria-label="Back"
									>
										<ArrowLeft className="size-4" aria-hidden="true" />
									</button>
									<div className="min-w-0">
										<Dialog.Title className="text-[15px] font-semibold text-foreground">
											{mode === "workspace" ? "Import workspace" : "Import project"}
										</Dialog.Title>
										<Dialog.Description className="mt-1 text-[12px] text-muted-foreground">
											{mode === "workspace"
												? "Pick a folder that contains your Git repositories."
												: "Import a single Git repository as one project."}
										</Dialog.Description>
									</div>
								</div>
								<Dialog.Close asChild>
									<button
										type="button"
										className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-surface hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
										aria-label="Close import dialog"
										disabled={isImporting}
									>
										<X className="size-4" aria-hidden="true" />
									</button>
								</Dialog.Close>
							</div>

							<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
								{selectedPath && scan ? (
									<div className="space-y-4">
										<div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
											<div className="min-w-0">
												<div className="font-mono text-[10px] uppercase tracking-[0.08em] text-passive">
													{mode === "workspace" ? "Workspace root" : "Project folder"}
												</div>
												<div className="mt-1 truncate text-[13px] text-foreground">{displayPath(selectedPath)}</div>
											</div>
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() => void chooseFolder()}
												disabled={isChoosing || isImporting}
											>
												<RefreshCw className="size-3.5" aria-hidden="true" />
												Change
											</Button>
										</div>

										{mode === "workspace" && failedRepos.length > 0 && (
											<div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-error">
												Validation failed · workspace not registered
											</div>
										)}

										{scan.repos.length === 0 ? (
											<div className="rounded-md border border-border bg-background px-3 py-4 text-[12px] text-muted-foreground">
												No repositories to import
											</div>
										) : (
											<div className="overflow-hidden rounded-md border border-border">
												{scan.repos.map((repo) => (
													<div
														key={repo.path}
														className="flex items-center gap-3 border-b border-border bg-background px-3 py-2.5 last:border-b-0"
													>
														{repo.hasRemote ? (
															<CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
														) : (
															<XCircle className="size-4 shrink-0 text-error" aria-hidden="true" />
														)}
														<div className="min-w-0 flex-1">
															<div className="truncate text-[13px] font-medium text-foreground">{repo.name}</div>
															<div className="mt-0.5 truncate text-[11px] text-passive">{displayPath(repo.path)}</div>
														</div>
														<div className="max-w-[220px] shrink-0 truncate text-right font-mono text-[11px] text-muted-foreground">
															{repo.hasRemote ? `${repo.branch} ${remoteHost(repo.remote)}` : "No remote configured"}
														</div>
													</div>
												))}
											</div>
										)}
									</div>
								) : (
									<button
										type="button"
										className="flex min-h-[230px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background/60 px-6 py-8 text-center transition hover:border-border-strong hover:bg-surface disabled:pointer-events-none disabled:opacity-60"
										onClick={() => void chooseFolder()}
										disabled={isChoosing || isImporting}
									>
										<FolderPlus className="size-8 text-accent" aria-hidden="true" />
										<div className="mt-4 text-[14px] font-semibold text-foreground">
											{mode === "workspace" ? "Choose a folder" : "Choose a project folder"}
										</div>
										<div className="mt-1 max-w-[360px] text-[12px] leading-5 text-muted-foreground">
											{mode === "workspace"
												? "Opens your system file picker — pick the folder that holds your repos"
												: "Opens your system file picker — select one repo folder"}
										</div>
									</button>
								)}

								{scanError && (
									<div className="mt-3 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-[12px] leading-5 text-error">
										{scanError}
									</div>
								)}
								{error && (
									<div className="mt-3 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-[12px] leading-5 text-error">
										{error}
									</div>
								)}
							</div>

							<div className="border-t border-border px-5 py-4">
								<div className="mb-3 grid gap-3 sm:grid-cols-2">
									<RequiredAgentField
										id="importWorkerAgent"
										label="Worker agent"
										placeholder="Select worker agent"
										value={workerAgent}
										onChange={setWorkerAgent}
									/>
									<RequiredAgentField
										id="importOrchestratorAgent"
										label="Orchestrator agent"
										placeholder="Select orchestrator agent"
										value={orchestratorAgent}
										onChange={setOrchestratorAgent}
									/>
								</div>
								<div className="flex items-center justify-between gap-3">
									<div className="min-w-0 text-[12px] text-muted-foreground">
										{mode === "workspace"
											? failedRepos.length > 0
												? `Resolve ${failedRepos.length} failed ${failedRepos.length === 1 ? "repository" : "repositories"} to continue`
												: scan?.repos.length
													? `${scan.repos.length} ${scan.repos.length === 1 ? "repository" : "repositories"} ready`
													: "No repositories to import"
											: projectReady
												? "Project folder selected"
												: "No repository to import"}
									</div>
									<div className="flex shrink-0 items-center gap-2">
										<Button type="button" variant="ghost" disabled={isImporting} onClick={() => onOpenChange(false)}>
											Cancel
										</Button>
										<Button type="button" variant="primary" disabled={!canImport} onClick={() => void submit()}>
											<Package className="size-3.5" aria-hidden="true" />
											{isImporting
												? "Importing..."
												: mode === "workspace"
													? "Import workspace"
													: "Import project"}
										</Button>
									</div>
								</div>
							</div>
						</div>
					)}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
