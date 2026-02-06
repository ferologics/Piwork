/* @vitest-environment node */

import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IntegrationHarness } from "./harness";

describe.sequential("runtime steady-state contracts", () => {
    const harness = new IntegrationHarness();
    const prefix = `regression-steady-${Date.now()}`;
    const workingFolder = path.resolve(process.cwd());

    beforeAll(async () => {
        await harness.start();
        await harness.deleteTasksByPrefix(prefix);
    }, 360_000);

    afterAll(async () => {
        await harness.deleteTasksByPrefix(prefix).catch(() => undefined);
        await harness.stop();
    }, 120_000);

    async function createAndSelectTask(suffix: string) {
        const title = `${prefix}-${suffix}`;
        await harness.createTask(title, null);

        const task = await harness.waitForTaskByTitle(title, 45_000);
        await harness.setTask(task.id);
        await harness.waitForTaskSettled(task.id, 120_000);

        return task;
    }

    it("preserves conversation state when binding the first working folder", async () => {
        const task = await createAndSelectTask("continuity");

        const initial = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            if (!snapshot.runtime.rpcConnected || snapshot.runtime.taskSwitching) {
                return null;
            }

            return snapshot;
        }, 90_000);

        expect(initial.ui.quickStartVisible).toBe(true);

        await harness.prompt("steady-state continuity probe");

        const withMessage = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            if (snapshot.conversation.messageCount < 1) {
                return null;
            }

            return snapshot;
        }, 120_000);

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

            if (!snapshot.runtimeDebug.currentCwd?.startsWith("/mnt/workdir")) {
                return null;
            }

            return snapshot;
        }, 150_000);

        expect(afterBind.conversation.messageCount).toBeGreaterThanOrEqual(messageCountBeforeBind);
        expect(afterBind.ui.bootScreenVisible).toBe(false);
        expect(afterBind.ui.quickStartVisible).toBe(false);
    }, 240_000);

    it("refreshes working-folder panel listing immediately after first bind", async () => {
        const task = await createAndSelectTask("panel-refresh");

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
        }, 90_000);

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
        }, 150_000);

        expect(afterBind.panels.workingFolderFileRowCount).toBeGreaterThan(0);
        expect(afterBind.panels.workingFolderEmptyVisible).toBe(false);
    }, 240_000);

    it("keeps runtime mismatch badge hidden during transient reconfigure", async () => {
        const task = await createAndSelectTask("mismatch");

        const settledBeforeBind = await harness.waitForTaskSettled(task.id, 120_000);
        expect(settledBeforeBind.runtimeDebug.mismatchVisible).toBe(false);

        await harness.setFolder(workingFolder);

        const settledAfterBind = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            const transient =
                snapshot.runtime.taskSwitching ||
                !snapshot.runtime.rpcConnected ||
                snapshot.ui.reconfigureBannerVisible;

            if (transient) {
                if (snapshot.runtimeDebug.mismatchVisible) {
                    throw new Error("runtime mismatch badge became visible during transient reconfigure state");
                }
                return null;
            }

            if (snapshot.task.currentWorkingFolder !== workingFolder) {
                return null;
            }

            return snapshot;
        }, 150_000);

        expect(settledAfterBind.runtimeDebug.mismatchVisible).toBe(false);
    }, 240_000);

    it("keeps model picker state truthful (empty/error/real)", async () => {
        const task = await createAndSelectTask("models");

        const settledModels = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            if (snapshot.models.loading) {
                return null;
            }

            return snapshot;
        }, 120_000);

        if (settledModels.models.error) {
            expect(settledModels.models.count).toBe(0);
            expect(settledModels.models.ids).toEqual([]);
            expect(settledModels.models.selectedModelId).toBe("");
            return;
        }

        if (settledModels.models.count === 0) {
            expect(settledModels.models.ids).toEqual([]);
            expect(settledModels.models.selectedModelId).toBe("");
            return;
        }

        expect(settledModels.models.ids.length).toBe(settledModels.models.count);
        expect(settledModels.models.selectedModelId).toBeTruthy();
        expect(settledModels.models.ids).toContain(settledModels.models.selectedModelId);
    }, 240_000);
});
