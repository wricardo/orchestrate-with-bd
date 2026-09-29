import { describe, expect, test } from "bun:test";
import { spawnCommand } from "../src/worktree";

describe("spawnCommand", () => {
	test("captures a successful command result", async () => {
		const result = await spawnCommand(["bun", "--version"], process.cwd(), { timeoutMs: 5_000 });
		expect(result).toMatchObject({ code: 0, quiescence: { confirmed: true } });
		expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/u);
	});
});
