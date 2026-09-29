import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeAgent, requiredRoles } from "../src/roles";

describe("role routing", () => {
	test("maps claim-pool role markers to their exact agents", () => {
		expect(activeAgent(["ORC-ROLE: implementer (basic tier)"])).toBe("orc-implementer");
		expect(activeAgent(["ORC-ROLE: implementer (deep tier)"])).toBe("orc-implementer-deep");
		expect(activeAgent(["ORC-ROLE: implementer (max tier)"])).toBe("orc-implementer-max");
		expect(activeAgent(["ORC-ROLE: reviewer"])).toBe("orc-reviewer");
		expect(activeAgent(["ORC-ROLE: merger"])).toBe("orc-merger");
	});

	test("ships supported model aliases and a single-checkout contract", () => {
		const supported: Record<string, true> = {
			"@advisor": true,
			"@commit": true,
			"@default": true,
			"@plan": true,
			"@slow": true,
			"@smol": true,
			"@task": true,
			"@tiny": true,
			"@vision": true,
		};
		for (const alias of requiredRoles().keys()) expect(supported[alias] === true, alias).toBe(true);
		const skill = readFileSync(join(import.meta.dir, "..", "skills", "orchestrate-with-bd", "SKILL.md"), "utf8");
		expect(skill).toContain("at most one ready bead");
		expect(skill).toContain("Do not create Git worktrees");
	});
});
