/**
 * Process and repository-path utilities used by the Beads ledger.
 *
 * The plugin resolves one repository root for every session and serializes its worker
 * dispatch, so no linked checkout is created or managed here.
 */

import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export type CommandQuiescence = { confirmed: true } | { confirmed: false; reason: string };

export interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
	/** Present for bounded commands whose process-tree settlement was observed. */
	quiescence?: CommandQuiescence;
}

/** Every Git probe must finish well inside the 30 s tool/session_start budget. */
export const GIT_PROBE_TIMEOUT_MS = 5_000;

/** Optional execution bound for probes that must not hold up session startup. */
export interface CommandOptions {
	timeoutMs?: number;
}

/** Runs one argv and waits. Injected so tests drive the ledger without a git repository. */
export type CommandRunner = (argv: readonly string[], cwd: string, options?: CommandOptions) => Promise<CommandResult>;
/** The caller must distinguish an unanswerable probe from an empty answer. */
function commandFailure(argv: readonly string[], cwd: string, result: CommandResult): string {
	const detail = result.stderr.trim() || result.stdout.trim();
	return detail.length > 0 ? detail : `${argv.join(" ")} in ${cwd} exited ${result.code}`;
}

const PROCESS_GROUP_POLL_MS = 10;
const PROCESS_GROUP_WAIT_MS = 1_000;

/** POSIX process-group liveness. EPERM is alive; only ESRCH proves every member is gone. */
function processGroupAlive(pgid: number): boolean {
	if (!Number.isSafeInteger(pgid) || pgid <= 0) return false;
	try {
		process.kill(-pgid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

/** Wait a bounded interval for SIGKILLed descendants to leave the process table. */
async function waitForProcessGroupExit(pgid: number): Promise<boolean> {
	const deadline = Date.now() + PROCESS_GROUP_WAIT_MS;
	while (processGroupAlive(pgid)) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) return false;
		await Bun.sleep(Math.min(PROCESS_GROUP_POLL_MS, remaining));
	}
	return true;
}

/**
 * Kill a timed command and everything it started, then wait for the foreground process and its
 * process group. The group leader may already have exited; its pgid still addresses descendants.
 */
async function terminateProcessTree(proc: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<boolean> {
	if (process.platform === "win32") {
		try {
			const killer = Bun.spawn(["taskkill", "/pid", String(proc.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
			const code = await Promise.race([killer.exited, Bun.sleep(PROCESS_GROUP_WAIT_MS).then(() => null)]);
			if (code === 0) return true;
			proc.kill("SIGKILL");
		} catch {
			try {
				proc.kill("SIGKILL");
			} catch {
				// The foreground process already exited.
			}
		}
		return false;
	}
	try {
		// Timed commands are detached solely to make their pid a process-group id. SIGKILL
		// therefore reaches the command and every foreground child it started.
		process.kill(-proc.pid, "SIGKILL");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
			try {
				proc.kill("SIGKILL");
			} catch {
				// The foreground process exited between observation and fallback.
			}
		}
	}
	// `proc.exited` is deliberately not awaited: Bun or an injected runner can fail to settle
	// it even after the OS process is gone. ESRCH for the group is the stronger completion fact.
	return waitForProcessGroupExit(proc.pid);
}

/** The real runner. Failure to spawn is a result with a non-zero code, never a throw. */
export const spawnCommand: CommandRunner = async (argv, cwd, options) => {
	const timeoutMs = options?.timeoutMs;
	let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		proc = Bun.spawn(argv as string[], { cwd, stdout: "pipe", stderr: "pipe", detached: timeoutMs !== undefined });
	} catch {
		return { code: 127, stdout: "", stderr: `${argv[0]} is not installed or not executable in ${cwd}` };
	}
	const result = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	if (timeoutMs === undefined) {
		const [stdout, stderr, code] = await result;
		return { code, stdout, stderr };
	}
	let timedOut = false;
	const terminated = Promise.withResolvers<boolean>();
	const timer = setTimeout(() => {
		timedOut = true;
		void terminateProcessTree(proc).then(terminated.resolve, () => terminated.resolve(false));
	}, timeoutMs);
	try {
		const outcome = await Promise.race([
			result.then(values => ({ kind: "completed" as const, values })),
			terminated.promise.then(groupGone => ({ kind: "timeout" as const, groupGone })),
		]);
		if (timedOut) {
			const groupGone = outcome.kind === "timeout" ? outcome.groupGone : await terminated.promise;
			const reason = "SIGKILL was sent, but process-group disappearance could not be confirmed within 1000ms";
			const suffix = groupGone ? "" : `; ${reason}`;
			return {
				code: 124,
				stdout: "",
				stderr: `${argv[0]} timed out after ${timeoutMs}ms in ${cwd}${suffix}`,
				quiescence: groupGone ? { confirmed: true } : { confirmed: false, reason },
			};
		}
		if (outcome.kind !== "completed") {
			const reason = `termination state was uncertain in ${cwd}`;
			return { code: 124, stdout: "", stderr: `${argv[0]} ${reason}`, quiescence: { confirmed: false, reason } };
		}
		const [stdout, stderr, code] = outcome.values;
		// A wrapper can exit while a same-group child continues with ignored stdio. A timed
		// foreground command owns no post-return worker, so quiesce that residual group too.
		if (process.platform !== "win32" && processGroupAlive(proc.pid) && !(await terminateProcessTree(proc))) {
			const reason = `SIGKILL was sent, but process-group disappearance could not be confirmed within 1000ms in ${cwd}`;
			return { code: 124, stdout: "", stderr: `${argv[0]} exited and ${reason}`, quiescence: { confirmed: false, reason } };
		}
		if (process.platform === "win32") {
			const reason = "foreground exit did not confirm descendant process quiescence on Windows";
			return { code, stdout, stderr, quiescence: { confirmed: false, reason } };
		}
		return { code, stdout, stderr, quiescence: { confirmed: true } };
	} finally {
		clearTimeout(timer);
	}
};

export type RootResolution = { kind: "known"; root: string } | { kind: "unknown"; reason: string };

function unknownRoot(argv: readonly string[], cwd: string, result: CommandResult): RootResolution {
	return { kind: "unknown", reason: commandFailure(argv, cwd, result) };
}

function gitOverride(): string | undefined {
	for (const name of ["GIT_DIR", "GIT_WORK_TREE"] as const) {
		const value = process.env[name]?.trim();
		if (value !== undefined && value.length > 0) return `${name}=${value}`;
	}
	return undefined;
}

/**
 * The absolute repository root containing `cwd`, derived from Git's common directory. An
 * unknown result is never a root: callers must refuse rather than silently redirecting a ledger
 * operation to `cwd`.
 */
export async function canonicalRoot(cwd: string, run: CommandRunner = spawnCommand): Promise<RootResolution> {
	const override = gitOverride();
	if (override !== undefined) return { kind: "unknown", reason: `refusing git environment override ${override}; it may identify a foreign repository` };
	const argv = ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"] as const;
	const result = await run(argv, cwd, { timeoutMs: GIT_PROBE_TIMEOUT_MS });
	if (result.code !== 0) return unknownRoot(argv, cwd, result);
	const common = result.stdout.trim();
	// `--path-format=absolute` promises an absolute path, so anything else is not a common dir
	// and must not be turned into a root: a guessed root would send every `bd` call elsewhere.
	if (!path.isAbsolute(common)) return { kind: "unknown", reason: `git returned a non-absolute common directory for ${cwd}: ${common || "(empty output)"}` };
	return { kind: "known", root: path.dirname(common) };
}

/**
 * `target` resolved through symlinks as far as it exists. A path that does not exist yet
 * still resolves its deepest existing ancestor, so containment cannot be defeated by naming
 * a file inside a symlinked directory.
 */
export function resolveDeepest(target: string): string {
	let current = path.resolve(target);
	const tail: string[] = [];
	for (;;) {
		try {
			return path.join(realpathSync(current), ...tail.reverse());
		} catch {
			const parent = path.dirname(current);
			if (parent === current) return path.resolve(target);
			tail.push(path.basename(current));
			current = parent;
		}
	}
}


/** Whether `target` is `root` or sits underneath it, compared by realpath, never lexically. */
export function isInside(target: string, root: string): boolean {
	const a = resolveDeepest(target);
	const b = resolveDeepest(root);
	return a === b || a.startsWith(b + path.sep);
}

