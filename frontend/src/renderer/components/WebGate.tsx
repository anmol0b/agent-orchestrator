import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { applyDaemonStatus } from "../lib/daemon-status";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type GateState = "checking" | "login" | "ready";

/**
 * Web-mode (VITE_AO_WEB=1) entry gate. The SPA shell and its assets are served
 * publicly by the daemon's authenticated listener, but every API/SSE/WS call
 * needs the ao_web_session cookie — so nothing inside the gate (no queries, no
 * streams, no sockets) mounts until /auth/session confirms it, and a successful
 * login flips the app straight into the ready/remote state that drives every
 * remote-mode capability gate.
 */
export function WebGate({ children }: { children: ReactNode }) {
	const [state, setState] = useState<GateState>("checking");

	useEffect(() => {
		let active = true;
		fetch("/auth/session", { credentials: "same-origin", cache: "no-store" })
			.then((resp) => (resp.ok ? resp.json() : { authenticated: false }))
			.then((body: { authenticated?: boolean }) => {
				if (active) setState(body.authenticated ? "ready" : "login");
			})
			.catch(() => {
				if (active) setState("login");
			});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		if (state === "ready") {
			applyDaemonStatus({ state: "ready", connection: "remote" });
		}
	}, [state]);

	if (state === "ready") return children;
	if (state === "checking") return <WebSplash />;
	return <WebLogin onSuccess={() => setState("ready")} />;
}

function WebSplash() {
	const { t } = useTranslation();
	return (
		<div className="flex h-dvh items-center justify-center bg-[var(--color-bg-import-modal)]">
			<p className="text-sm text-[var(--color-text-import-muted)]">{t("webLogin.checking")}</p>
		</div>
	);
}

function WebLogin({ onSuccess }: { onSuccess: () => void }) {
	const { t } = useTranslation();
	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!password || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const resp = await fetch("/auth/login", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password }),
			});
			if (resp.ok) {
				onSuccess();
				return;
			}
			if (resp.status === 401) setError(t("webLogin.badPassword"));
			else if (resp.status === 429) setError(t("webLogin.lockedOut"));
			else setError(t("webLogin.unreachable"));
		} catch {
			setError(t("webLogin.unreachable"));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="flex h-dvh items-center justify-center bg-[var(--color-bg-import-modal)]">
			<form
				onSubmit={(event) => void submit(event)}
				className="flex w-80 flex-col gap-4 rounded-welcome-panel border border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-card)] p-6"
			>
				<div>
					<h1 className="text-base font-semibold text-[var(--color-text-import-title)]">{t("webLogin.title")}</h1>
					<p className="mt-1 text-xs text-[var(--color-text-import-muted)]">{t("webLogin.subtitle")}</p>
				</div>
				<Input
					type="password"
					autoFocus
					autoComplete="current-password"
					placeholder={t("webLogin.passwordPlaceholder")}
					value={password}
					onChange={(event) => setPassword(event.target.value)}
				/>
				{error ? (
					<p className="text-xs text-error" role="alert">
						{error}
					</p>
				) : null}
				<Button type="submit" disabled={submitting || !password}>
					{submitting ? t("webLogin.signingIn") : t("webLogin.signIn")}
				</Button>
			</form>
		</div>
	);
}
