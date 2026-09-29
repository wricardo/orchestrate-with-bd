/**
 * orchestrate-with-bd — a durable Beads ledger beside OMP's native `orchestrate` keyword.
 *
 * OMP owns scheduling, agent lifecycle, and cancellation. This plugin owns the per-session
 * actor every `bd` mutation is attributed to, a run header injected when a prompt says
 * `orchestrate`, and the ledger tools (`orc_claim`, `orc_finish`, `orc_status`) that make
 * Beads the source of truth for work and state. Workers share the current checkout and are
 * dispatched serially.
 *
 * The plugin does not schedule workers or discover stores. Ownership is lease-only: a claim
 * carries bd's native lease, nothing renews it on a timer, and the recorded lead's next call after
 * its own epic lease expired issues one native heartbeat before proceeding.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { readStoreMode, type WaveItem } from "./dag";
import { mentionsOrchestrate } from "./keyword";
import { activeAgent, activeRoleStop, missingRoles, rolesStop } from "./roles";
import { registerBotReviewProbe } from "./tools/bot-review-probe";
import { registerBotReviewRequest } from "./tools/bot-review-request";
import { namedBeads, observeLifecycle, recordDispatch, waveGate } from "./dispatch";
import { registerConflictProbe } from "./tools/conflict-probe";
import { actorFor, clearStatusWave, discoverRun, ledgerRoot, registerLedger, statusBeadIds, statusWave } from "./tools/ledger";
import { registerReviewRoundPolicy } from "./tools/review-round-policy";
import { spawnCommand, type CommandResult } from "./worktree";

const stoppedSessions = new Map<string, string>();
const ghPreflightBySession = new Map<string, Promise<CommandResult>>();

function ghPreflight(sessionId: string, root: string): Promise<CommandResult> {
	const cached = ghPreflightBySession.get(sessionId);
	if (cached !== undefined) return cached;
	const probe = spawnCommand(["gh", "auth", "status"], root, { timeoutMs: 2_000 }).catch(error => ({ code: 127, stdout: "", stderr: String(error) }));
	ghPreflightBySession.set(sessionId, probe);
	return probe;
}

function ghStatusOk(result: CommandResult): boolean {
	const output = `${result.stdout}\n${result.stderr}`;
	return result.code === 0 && /github\.com[\s\S]*(?:logged\s+in|account)/iu.test(output);
}

function ghDiagnostic(result: CommandResult): string {
	const detail = result.stderr.trim() || result.stdout.trim();
	return (detail || `exit ${result.code}`).slice(0, 2_000).replace(/\r?\n/gu, " | ");
}

const COMPANION_KEYS = [
	["beads", "com.srobroek.beads.present.v1"],
	["build", "com.srobroek.build.present.v1"],
] as const;

function missingCompanions(): string[] {
	return COMPANION_KEYS.filter(([, key]) => {
		const marker = (globalThis as Record<symbol, unknown>)[Symbol.for(key)];
		return marker === undefined || marker === null || typeof marker !== "object" || Array.isArray(marker);
	}).map(([name]) => name);
}

function companionStop(missing: readonly string[]): string {
	return `STOP. omp-orchestrate requires companion plugins that are not loaded: ${missing.join(", ")}. Enable them from the srobroek-omp marketplace, then restart the session.`;
}
const LEDGER_TOOLS: Readonly<Record<string, true>> = Object.freeze({
	orc_bind: true,
	orc_claim: true,
	orc_decide: true,
	orc_finish: true,
	orc_release: true,
	orc_status: true,
});

function claimAgent(input: unknown): string | undefined {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
	const agent = (input as Record<string, unknown>).agent;
	return typeof agent === "string" && agent.length > 0 ? agent : undefined;
}
const CONTRACT = [
	"- Read `skill://orchestrate-with-bd` before dispatching.",
	"- Beads is the only source of truth for work and state. The todo list is a per-turn view of `orc_status.todo`, never an independent plan.",
	"- In plan mode, name the epic and every task bead in a `## Beads` section. Create a bead before planning work for it.",
	"- This run uses one shared checkout. Never create a git worktree, never request task isolation, and never dispatch a second worker until the first worker has reached a terminal state.",
	"- Dispatch only the single bead returned by `orc_status.ready` through the native `task` tool. After it returns, call `orc_status` again. Helpers such as `scout` are exempt only when they do not mutate the checkout.",
	"- Each worker claims its bead first, works in its inherited checkout, runs the bead's acceptance checks, and finishes through `orc_finish`.",
	"- Bind first with `orc_bind { epic }`. Lead ledger writes are `orc_bind`, `orc_decide`, and explicit native Beads DAG updates; `orc_status` reads. A worker brief must not contain the bare lowercase word `orchestrate`.",
].join("\n");
/** The bash input with both actor names added to its `env`. Malformed env values are replaced with a fresh object. */
function withActor(input: unknown, actor: string): Record<string, unknown> | undefined {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
	const env = "env" in input ? input.env : undefined;
	const values = env !== null && typeof env === "object" && !Array.isArray(env) ? Object.fromEntries(Object.entries(env as Record<string, unknown>).filter(([, value]) => typeof value === "string")) : {};
	return { ...(input as Record<string, unknown>), env: { ...values, BD_ACTOR: actor, BEADS_ACTOR: actor } };
}

/**
 * Route each `task` item to the agent its bead's wave entry names. An item whose agent is an
 * `orc-*` role (or unset) and whose brief names exactly one wave bead gets that entry's `agent`.
 * Helpers are never rerouted, and items naming no wave bead or several are left alone.
 * Returns the revised input, or `undefined` when nothing changes.
 */
export function routeDispatch(input: unknown, wave: ReadonlyMap<string, WaveItem>): Record<string, unknown> | undefined {
	if (input === null || typeof input !== "object" || wave.size === 0) return undefined;
	const record = input as Record<string, unknown>;
	const items = Array.isArray(record.tasks) ? record.tasks : [record];
	let changed = false;
	const routed = items.map(item => {
		if (item === null || typeof item !== "object") return item;
		const current = item as Record<string, unknown>;
		const brief = current.task;
		if (typeof brief !== "string") return item;
		if (current.agent !== undefined && !(typeof current.agent === "string" && current.agent.startsWith("orc-"))) return item;
		const named = namedBeads(brief, wave).map(bead => wave.get(bead)).filter((entry): entry is WaveItem => entry !== undefined);
		if (named.length !== 1) return item;
		const [entry] = named;
		if (current.agent === entry.agent) return item;
		changed = true;
		return { ...current, agent: entry.agent };
	});
	if (!changed) return undefined;
	return Array.isArray(record.tasks) ? { ...record, tasks: routed } : (routed[0] as Record<string, unknown>);
}

const NO_RUN = "no run epic yet — create the epic, then call orc_bind { epic } to bind it";

/**
 * Build the run header for one prompt. Exported for keyword tests.
 *
 * The run is read from the ledger rather than a file beside the checkout, so every session
 * resolves the same durable Beads state and repository root.
 */
export async function runHeader(cwd: string, actor: string, stop?: string, resolveRoot: (cwd: string) => Promise<string> = ledgerRoot, sessionId = actor): Promise<string> {
	let root: string;
	try {
		root = await resolveRoot(cwd);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		const lines = ["<system-notice>", "orchestrate-with-bd run header", `canonical checkout: unknown (cwd: ${cwd})`, "store: unknown", `run epic: ${NO_RUN}`, `actor: ${actor}`, "", `STOP. refusing ledger access because the canonical checkout is unknown: ${reason}`];
		if (stop !== undefined) lines.push(stop);
		lines.push("</system-notice>");
		return lines.join("\n");
	}
	const store = readStoreMode(root);
	const storeLine = store === null ? "no .beads/metadata.json" : `${store.database ?? "?"} (${store.mode || "?"} mode)`;
	const lookup = await discoverRun(root, actor).catch(() => ({ state: "none" }) as const);
	const run =
		lookup.state === "bound"
			? `${lookup.owned.epic.id}${lookup.owned.run.root === lookup.owned.epic.id ? "" : ` (run root ${lookup.owned.run.root})`}`
			: lookup.state === "stale"
				? lookup.epic === undefined
					? `${NO_RUN} — ${lookup.reason}`
					: `${lookup.epic} (native lease is not live; call orc_bind { epic: ${JSON.stringify(lookup.epic)} } to renew it)`
				: lookup.state === "ambiguous"
					? `AMBIGUOUS: ${lookup.epics.join(", ")} are both bound to you; close or release one`
					: NO_RUN;
	const lines = ["<system-notice>", "orchestrate-with-bd run header", `canonical checkout: ${root}`, `store: ${storeLine}`, `run epic: ${run}`, `actor: ${actor}`, ""];
	if (lookup.state === "bound" && !lookup.owned.run.ci_scoped) lines.push("This repository's CI is not fully scoped away from pull requests into `omp/**`; orc_bind reported what it could not change. Scope the rest before dispatching a wave.");
	const [gh, optional] = await Promise.all([
		ghPreflight(sessionId, root),
		Promise.resolve(`optional agents: security-reviewer=unknown, operator=${missingCompanions().includes("build") ? "missing via build marker" : "present"}, scout=unknown`),
	]);
	lines.push(ghStatusOk(gh) ? "gh: ok" : `gh: unavailable (${ghDiagnostic(gh)})`, optional);
	if (stop !== undefined) {
		lines.push(stop, "</system-notice>");
		return lines.join("\n");
	}
	lines.push(CONTRACT, "</system-notice>");
	return lines.join("\\n");
}

export default function orchestrateWithBd(pi: ExtensionAPI): void {
	pi.setLabel("Orchestrate with bd");


	pi.on("tool_call", (event, ctx) => {
		const session = ctx.sessionManager.getSessionId();
		if (event.toolName === "task" || LEDGER_TOOLS[event.toolName] === true) {
			const missing = missingCompanions();
			if (missing.length > 0) return { block: true, reason: companionStop(missing) };
		}
		const stopped = stoppedSessions.get(session);
		if (stopped !== undefined && (event.toolName === "task" || LEDGER_TOOLS[event.toolName] === true)) return { block: true, reason: stopped };
		if (LEDGER_TOOLS[event.toolName] === true) {
			const roleStop = activeRoleStop(ctx.models, ctx.getSystemPrompt(), undefined, ctx.sessionManager.getEntries?.() ?? []);
			if (roleStop !== undefined) {
				stoppedSessions.set(session, roleStop);
				return { block: true, reason: roleStop };
			}
		}
		if (event.toolName === "orc_claim") {
			const active = activeAgent(ctx.getSystemPrompt());
			const supplied = claimAgent(event.input);
			if (active !== undefined && supplied !== active) return { block: true, reason: `orc_claim refused: the active agent is ${active}, but the call named ${supplied ?? "no agent"}. Pass agent: "${active}" so a claim-pool bead cannot be taken by a mismatched role.` };
		}
		if (event.toolName === "task") {
			try {
				const wave = statusWave(ctx);
				if (wave === null || wave.size === 0) return undefined;
				const gate = waveGate(event.input, wave);
				if (gate === undefined) return undefined;
				if ("block" in gate) return gate;
				recordDispatch({ toolCallId: event.toolCallId, sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, actor: actorFor(ctx), beadsByIndex: gate.beadsByIndex, workers: new Map() });
				clearStatusWave(ctx);
				const routed = routeDispatch(event.input, wave);
				return routed === undefined ? undefined : { input: routed };
			} catch { return undefined; }
		}
		if (event.toolName !== "bash") return undefined;
		const revised = withActor(event.input, actorFor(ctx));
		return revised === undefined ? undefined : { input: revised };
	});
	pi.events.on("task:subagent:lifecycle", payload => observeLifecycle(payload as Parameters<typeof observeLifecycle>[0]));

	pi.on("before_agent_start", async (event, ctx) => {
		if (!mentionsOrchestrate(event.prompt)) return undefined;
		const companions = missingCompanions();
		let stop: string | undefined;
		if (companions.length > 0) {
			stop = companionStop(companions);
		} else {
			const missing = missingRoles(ctx.models);
			stop = missing.size > 0 ? rolesStop(missing) : activeRoleStop(ctx.models, ctx.getSystemPrompt(), undefined, ctx.sessionManager.getEntries?.() ?? []);
			if (stop !== undefined) stoppedSessions.set(ctx.sessionManager.getSessionId(), stop);
		}
		return { message: { customType: "orc-run-header", display: false, attribution: "user", content: await runHeader(ctx.cwd, actorFor(ctx), stop, ledgerRoot, ctx.sessionManager.getSessionId()) } };
	});

	pi.on("todo_reminder", async (event, ctx) => {
		const ids = statusBeadIds(ctx);
		if (ids === null) return;
		const drifted = event.todos.map(todo => todo.content).filter(content => !ids.has(content.trim().split(/\s+/u, 1)[0] ?? ""));
		if (drifted.length === 0) return;
		pi.sendUserMessage(`todo items not backed by a bead in the bound run: ${drifted.map(item => JSON.stringify(item)).join(", ")}. Re-read orc_status and rewrite the todo list from orc_status.todo.`, { deliverAs: "followUp" });
	});

	registerLedger(pi);
	registerBotReviewProbe(pi);
	registerBotReviewRequest(pi);
	registerConflictProbe(pi);
	registerReviewRoundPolicy(pi);
}
