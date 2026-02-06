/* @vitest-environment node */

import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IntegrationHarness } from "./harness";

describe.sequential("runtime cwd reopen regression", () => {
    const harness = new IntegrationHarness();
    const prefix = `regression-reopen-cwd-${Date.now()}`;

    let taskId: string | null = null;
    const workingFolder = path.resolve(process.cwd());

    beforeAll(async () => {
        await harness.start();
    }, 240_000);

    afterAll(async () => {
        if (taskId) {
            await harness.deleteTask(taskId).catch(() => undefined);
        }

        await harness.stop();
    }, 60_000);

    it("reopens existing folder-bound task with cwd under /mnt/workdir", async () => {
        const title = `${prefix}-task`;
        await harness.createTask(title, workingFolder);

        const task = await harness.waitForTaskByTitle(title, 30_000);
        taskId = task.id;

        await harness.setTask(task.id);

        await harness.waitForSnapshot((snapshot) => {
            if (!snapshot.runtime.rpcConnected || snapshot.runtime.taskSwitching) {
                return null;
            }

            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            return snapshot;
        }, 60_000);

        await harness.restart();
        await harness.setTask(task.id);

        const settled = await harness.waitForSnapshot((snapshot) => {
            if (!snapshot.runtime.rpcConnected || snapshot.runtime.taskSwitching) {
                return null;
            }

            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            const cwd = snapshot.runtimeDebug.currentCwd;
            if (!cwd || !cwd.startsWith("/mnt/workdir")) {
                return null;
            }

            return snapshot;
        }, 120_000);

        const cwd = settled.runtimeDebug.currentCwd;
        expect(cwd).toBeTruthy();
        expect(cwd?.startsWith("/mnt/workdir")).toBe(true);
        expect(cwd?.includes("/mnt/taskstate/")).toBe(false);
        expect(cwd?.endsWith("/outputs")).toBe(false);
    }, 240_000);
});
