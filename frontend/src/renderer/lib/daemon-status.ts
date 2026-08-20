import { aoBridge } from "./bridge";
import { setApiBaseUrl, setApiDaemonStatus } from "./api-client";
import { isWebMode, readWebDaemonStatus } from "./web-mode";

export type DaemonStatus = Awaited<ReturnType<typeof aoBridge.daemon.getStatus>>;

export function applyDaemonStatus(nextStatus: DaemonStatus): void {
	setApiDaemonStatus(nextStatus);
	if (isWebMode()) {
		// Web mode: the daemon serves this page, so every transport is same-origin.
		setApiBaseUrl(nextStatus.state === "ready" ? window.location.origin : null);
		return;
	}
	if (nextStatus.state === "ready" && nextStatus.port) {
		setApiBaseUrl(`http://127.0.0.1:${nextStatus.port}`);
	} else {
		setApiBaseUrl(null);
	}
}

export async function refreshDaemonStatus(): Promise<DaemonStatus> {
	const nextStatus = await readDaemonStatus();
	applyDaemonStatus(nextStatus);
	return nextStatus;
}

export function readDaemonStatus(): Promise<DaemonStatus> {
	if (isWebMode()) {
		return readWebDaemonStatus() as Promise<DaemonStatus>;
	}
	return aoBridge.daemon.getStatus();
}
