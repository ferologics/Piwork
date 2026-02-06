/* @vitest-environment node */

import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IntegrationHarness } from "./harness";

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

describe.sequential("sequential journey canary", () => {
    const harness = new IntegrationHarness();
    const prefix = `regression-journey-${Date.now()}`;

    let taskId: string | null = null;

    const workingFolder = path.resolve(process.cwd());
    const artifactFileName = `journey-${Date.now()}.txt`;
    const artifactToken = `journey-token-${Date.now()}`;

    beforeAll(async () => {
        await harness.start();
        await harness.deleteTasksByPrefix(prefix);
    }, 300_000);

    afterAll(async () => {
        if (taskId) {
            await harness.deleteTask(taskId).catch(() => undefined);
        }

        await harness.deleteTasksByPrefix(prefix).catch(() => undefined);
        await harness.stop();
    }, 120_000);

    it("covers messages, models, workdir bind, artifacts, and reopen", async () => {
        const title = `${prefix}-task`;
        await harness.createTask(title, null);

        const task = await harness.waitForTaskByTitle(title, 30_000);
        taskId = task.id;

        await harness.setTask(task.id);

        const initial = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            if (!snapshot.runtime.rpcConnected || snapshot.runtime.taskSwitching) {
                return null;
            }

            const cwd = snapshot.runtimeDebug.currentCwd;
            if (!cwd || !cwd.endsWith("/outputs")) {
                return null;
            }

            return snapshot;
        }, 90_000);

        const outputsDir = initial.runtimeDebug.currentCwd;
        expect(outputsDir).toBeTruthy();

        if (!outputsDir) {
            throw new Error("missing outputs cwd for artifact write");
        }

        const baselineMessageCount = initial.conversation.messageCount;

        await harness.prompt("sequential journey continuity probe");

        const withMessage = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            if (snapshot.conversation.messageCount <= baselineMessageCount) {
                return null;
            }

            return snapshot;
        }, 90_000);

        expect(withMessage.ui.quickStartVisible).toBe(false);

        const modelSnapshot = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            if (snapshot.models.loading) {
                return null;
            }

            return snapshot;
        }, 90_000);

        if (modelSnapshot.models.error) {
            expect(modelSnapshot.models.count).toBe(0);
            expect(modelSnapshot.models.ids).toEqual([]);
            expect(modelSnapshot.models.selectedModelId).toBe("");
        } else if (modelSnapshot.models.count === 0) {
            expect(modelSnapshot.models.ids).toEqual([]);
            expect(modelSnapshot.models.selectedModelId).toBe("");
        } else {
            expect(modelSnapshot.models.ids.length).toBe(modelSnapshot.models.count);
            expect(modelSnapshot.models.selectedModelId).toBeTruthy();
            expect(modelSnapshot.models.ids).toContain(modelSnapshot.models.selectedModelId);
        }

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

            const cwd = snapshot.runtimeDebug.currentCwd;
            if (!cwd || !cwd.startsWith("/mnt/workdir")) {
                return null;
            }

            if (snapshot.panels.workingFolderFileRowCount < 1) {
                return null;
            }

            return snapshot;
        }, 150_000);

        expect(afterBind.conversation.messageCount).toBeGreaterThanOrEqual(withMessage.conversation.messageCount);
        expect(afterBind.ui.quickStartVisible).toBe(false);

        const previewList = await harness.previewList(task.id);
        expect(previewList.files.length).toBeGreaterThan(0);

        const previewPath = previewList.files[0]?.path ?? null;
        if (!previewPath) {
            throw new Error("missing preview path after working-folder bind");
        }

        await harness.openPreview(task.id, previewPath);

        const previewSnapshot = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            if (!snapshot.preview.isOpen || snapshot.preview.taskId !== task.id) {
                return null;
            }

            if (snapshot.preview.relativePath !== previewPath) {
                return null;
            }

            if (snapshot.preview.loading) {
                return null;
            }

            return snapshot;
        }, 90_000);

        expect(previewSnapshot.preview.error).toBe(null);
        expect(previewSnapshot.preview.source).toBe("preview");

        const artifactPath = `${outputsDir}/${artifactFileName}`;
        const writeCommand = `mkdir -p ${shellQuote(outputsDir)} && printf '%s' ${shellQuote(artifactToken)} > ${shellQuote(artifactPath)}`;

        await harness.sendRpc({
            id: `journey-system-bash-${Date.now()}`,
            type: "system_bash",
            payload: {
                command: writeCommand,
            },
        });

        await harness.waitForArtifact(task.id, "outputs", artifactFileName, 90_000);

        const artifactBeforeRestart = await harness.artifactRead(task.id, "outputs", artifactFileName);
        expect(artifactBeforeRestart.encoding).toBe("utf8");
        expect(artifactBeforeRestart.content).toBe(artifactToken);

        await harness.restart();
        await harness.setTask(task.id);

        const reopened = await harness.waitForSnapshot((snapshot) => {
            if (snapshot.task.currentTaskId !== task.id) {
                return null;
            }

            if (!snapshot.runtime.rpcConnected || snapshot.runtime.taskSwitching) {
                return null;
            }

            if (snapshot.task.currentWorkingFolder !== workingFolder) {
                return null;
            }

            const cwd = snapshot.runtimeDebug.currentCwd;
            if (!cwd || !cwd.startsWith("/mnt/workdir")) {
                return null;
            }

            return snapshot;
        }, 150_000);

        expect(reopened.runtimeDebug.currentCwd?.includes("/mnt/taskstate/")).toBe(false);
        expect(reopened.runtimeDebug.currentCwd?.endsWith("/outputs")).toBe(false);

        await harness.waitForArtifact(task.id, "outputs", artifactFileName, 90_000);
        const artifactAfterRestart = await harness.artifactRead(task.id, "outputs", artifactFileName);

        expect(artifactAfterRestart.encoding).toBe("utf8");
        expect(artifactAfterRestart.content).toBe(artifactToken);
    }, 420_000);
});
