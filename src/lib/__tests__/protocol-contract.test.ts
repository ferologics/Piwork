/* @vitest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
    const absolutePath = path.join(ROOT_DIR, relativePath);
    return readFileSync(absolutePath, "utf8");
}

describe("runtime protocol contract", () => {
    it("keeps taskd host command parsing strict envelope-only", () => {
        const taskd = readRepoFile("runtime/taskd.js");

        expect(taskd).not.toContain("function sendLegacyResponse");
        expect(taskd).not.toContain("function handleLegacy");
        expect(taskd).not.toContain("function isV2Request");
        expect(taskd).not.toContain('case "get_state":');
        expect(taskd).toContain('case "runtime_get_state":');

        expect(taskd).toContain("Request id is required");
        expect(taskd).toContain("Request payload must be an object");
    });

    it("keeps RuntimeService pending-response correlation restricted to taskd envelopes", () => {
        const runtimeService = readRepoFile("src/lib/services/runtimeService.ts");

        expect(runtimeService).toContain('const isTaskdResponse = typeof payload.ok === "boolean";');
        expect(runtimeService).not.toContain('payload.type === "response"');
    });
});
