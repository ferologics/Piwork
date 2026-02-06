/* @vitest-environment node */

import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IntegrationHarness } from "./harness";

describe.sequential("runtime mismatch badge semantics regression", () => {
    const harness = new IntegrationHarness();
    const prefix = `regression-mismatch-${Date.now()}`;

    const workingFolder = path.resolve(process.cwd());

    beforeAll(async () => {
        await harness.start();
        await harness.deleteTasksByPrefix(prefix);
    }, 240_000);

    afterAll(async () => {
        await harness.deleteTasksByPrefix(prefix).catch(() => undefined);
        await harness.stop();
    }, 90_000);

    it("does not show runtime mismatch badge during transient reconfigure states", async () => {
        const title = `${prefix}-task`;
        await harness.createTask(title, null);

        const task = await harness.waitForTaskByTitle(title, 30_000);
        await harness.setTask(task.id);

        const settledBeforeBind = await harness.waitForTaskSettled(task.id, 90_000);
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
        }, 120_000);

        expect(settledAfterBind.runtimeDebug.mismatchVisible).toBe(false);
    }, 240_000);
});
