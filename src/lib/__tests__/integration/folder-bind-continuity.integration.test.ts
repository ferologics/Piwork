/* @vitest-environment node */

import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IntegrationHarness } from "./harness";

describe.sequential("folder bind continuity regression", () => {
    const harness = new IntegrationHarness();
    const prefix = `regression-folder-bind-${Date.now()}`;

    const workingFolder = path.resolve(process.cwd());

    beforeAll(async () => {
        await harness.start();
        await harness.deleteTasksByPrefix(prefix);
    }, 240_000);

    afterAll(async () => {
        await harness.deleteTasksByPrefix(prefix).catch(() => undefined);
        await harness.stop();
    }, 90_000);

    it("does not reset conversation state when binding first working folder", async () => {
        const title = `${prefix}-task`;
        await harness.createTask(title, null);

        const task = await harness.waitForTaskByTitle(title, 30_000);
        await harness.setTask(task.id);
        await harness.waitForTaskSettled(task.id, 90_000);

        const initial = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            if (!snapshot.runtime.rpcConnected || snapshot.runtime.taskSwitching) {
                return null;
            }

            return snapshot;
        }, 60_000);

        expect(initial.ui.quickStartVisible).toBe(true);

        await harness.prompt("continuity probe");

        const withMessage = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            if (snapshot.conversation.messageCount < 1) {
                return null;
            }

            return snapshot;
        }, 90_000);

        const messageCountBeforeBind = withMessage.conversation.messageCount;
        expect(messageCountBeforeBind).toBeGreaterThan(0);
        expect(withMessage.ui.quickStartVisible).toBe(false);

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

            return snapshot;
        }, 120_000);

        expect(afterBind.conversation.messageCount).toBeGreaterThanOrEqual(messageCountBeforeBind);
        expect(afterBind.conversation.messageCount).toBeGreaterThan(0);
        expect(afterBind.ui.bootScreenVisible).toBe(false);
        expect(afterBind.ui.quickStartVisible).toBe(false);
    }, 240_000);
});
