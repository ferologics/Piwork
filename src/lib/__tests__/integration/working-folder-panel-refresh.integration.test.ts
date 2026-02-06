/* @vitest-environment node */

import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IntegrationHarness } from "./harness";

describe.sequential("working folder panel refresh regression", () => {
    const harness = new IntegrationHarness();
    const prefix = `regression-working-panel-${Date.now()}`;

    const workingFolder = path.resolve(process.cwd());

    beforeAll(async () => {
        await harness.start();
        await harness.deleteTasksByPrefix(prefix);
    }, 240_000);

    afterAll(async () => {
        await harness.deleteTasksByPrefix(prefix).catch(() => undefined);
        await harness.stop();
    }, 90_000);

    it("refreshes working-folder file list immediately after first bind", async () => {
        const title = `${prefix}-task`;
        await harness.createTask(title, null);

        const task = await harness.waitForTaskByTitle(title, 30_000);
        await harness.setTask(task.id);
        await harness.waitForTaskSettled(task.id, 90_000);

        const beforeBind = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            if (!snapshot.runtime.rpcConnected || snapshot.runtime.taskSwitching) {
                return null;
            }

            if (snapshot.task.currentWorkingFolder !== null) {
                return null;
            }

            return snapshot;
        }, 60_000);

        expect(beforeBind.panels.workingFolderFileRowCount).toBe(0);

        await harness.setFolder(workingFolder);

        const afterBind = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            if (!snapshot.runtime.rpcConnected || snapshot.runtime.taskSwitching) {
                return null;
            }

            if (snapshot.task.currentWorkingFolder !== workingFolder) {
                return null;
            }

            if (snapshot.panels.workingFolderFileRowCount < 1) {
                return null;
            }

            return snapshot;
        }, 120_000);

        expect(afterBind.panels.workingFolderFileRowCount).toBeGreaterThan(0);
        expect(afterBind.panels.workingFolderEmptyVisible).toBe(false);
    }, 240_000);
});
