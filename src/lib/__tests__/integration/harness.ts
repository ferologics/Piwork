import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const INTEGRATION_LOG_PATH = path.join(REPO_ROOT, "tmp/dev/piwork.integration.log");
const APP_LOG_PATH = path.join(REPO_ROOT, "tmp/dev/piwork.log");

const HOME_DIR = process.env.HOME ?? "";
const QEMU_LOG_CANDIDATES = HOME_DIR
    ? [
          path.join(HOME_DIR, "Library/Application Support/com.pi.work/vm/qemu.log"),
          path.join(HOME_DIR, ".local/share/com.pi.work/vm/qemu.log"),
      ]
    : [];

const TEST_SERVER_HOST = "127.0.0.1";
const TEST_SERVER_PORT = 19385;

const START_TIMEOUT_MS = 360_000;
const SNAPSHOT_TIMEOUT_MS = 180_000;
const COMMAND_TIMEOUT_MS = 15_000;

interface TaskSummary {
    id: string;
    title: string;
    workingFolder: string | null;
}

interface ArtifactFileEntry {
    source: "outputs" | "uploads" | string;
    path: string;
    size: number;
    modifiedAt: number;
    readOnly: boolean;
}

interface ArtifactListResponse {
    files: ArtifactFileEntry[];
    truncated: boolean;
}

interface PreviewFileEntry {
    path: string;
    size: number;
    modifiedAt: number;
}

interface PreviewListResponse {
    root: string;
    files: PreviewFileEntry[];
    truncated: boolean;
}

interface PreviewReadResponse {
    path: string;
    mimeType: string;
    encoding: string;
    content: string;
    truncated: boolean;
    size: number;
}

function isOkResponse(response: string): boolean {
    return response === "OK";
}

export interface StateSnapshot {
    schemaVersion: number;
    timestamp: string;
    task: {
        currentTaskId: string | null;
        activeTaskId: string | null;
        currentWorkingFolder: string | null;
        currentSessionFile: string | null;
        workspaceRoot: string | null;
    };
    runtime: {
        rpcConnected: boolean;
        rpcConnecting: boolean;
        rpcError: string | null;
        hasConnectedOnce: boolean;
        taskSwitching: boolean;
    };
    conversation: {
        messageCount: number;
        isAgentRunning: boolean;
        hasError: boolean;
    };
    composer: {
        promptLength: number;
        promptSending: boolean;
        promptInFlight: boolean;
        canSendPrompt: boolean;
    };
    ui: {
        bootScreenVisible: boolean;
        reconfigureBannerVisible: boolean;
        quickStartVisible: boolean;
        loginPromptVisible: boolean;
        pendingUiRequest: boolean;
    };
    models: {
        count: number;
        ids: string[];
        loading: boolean;
        error: string | null;
        selectedModelId: string;
        bootstrapStatus?: string | null;
        bootstrapError?: string | null;
    };
    preview: {
        isOpen: boolean;
        taskId: string | null;
        relativePath: string | null;
        source: "preview" | "artifact";
        artifactSource: "outputs" | "uploads" | null;
        loading: boolean;
        error: string | null;
    };
    runtimeDebug: {
        activeTaskId: string | null;
        currentCwd: string | null;
        workingFolderRelative: string | null;
        mismatchVisible: boolean;
    };
    panels: {
        workingFolderFileRowCount: number;
        workingFolderLoadingVisible: boolean;
        workingFolderEmptyVisible: boolean;
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
    fn: () => Promise<T | null> | T | null,
    timeoutMs: number,
    intervalMs: number,
    label: string,
    onTimeout?: () => Promise<string> | string,
): Promise<T> {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        const result = await fn();
        if (result !== null) {
            return result;
        }

        await sleep(intervalMs);
    }

    let details = "";
    if (onTimeout) {
        try {
            const maybeDetails = await onTimeout();
            if (maybeDetails.trim()) {
                details = `\n${maybeDetails}`;
            }
        } catch {
            // Ignore diagnostic failures.
        }
    }

    throw new Error(`Timed out waiting for ${label}${details}`);
}

function bestEffortStopProcesses(): void {
    try {
        execSync("pkill -9 piwork", { stdio: "ignore" });
    } catch {
        // Ignore.
    }

    try {
        execSync("pkill -9 qemu-system", { stdio: "ignore" });
    } catch {
        // Ignore.
    }

    try {
        execSync("pkill -f 'tauri dev'", { stdio: "ignore" });
    } catch {
        // Ignore.
    }

    try {
        execSync("pkill -f 'vite dev'", { stdio: "ignore" });
    } catch {
        // Ignore.
    }
}

export class IntegrationHarness {
    private child: ChildProcess | null = null;
    private logStream: ReturnType<typeof createWriteStream> | null = null;
    private lastSnapshot: StateSnapshot | null = null;

    private readTail(filePath: string, maxChars = 10_000): string {
        if (!existsSync(filePath)) {
            return `(missing: ${filePath})`;
        }

        try {
            const content = readFileSync(filePath, "utf8");
            if (!content.trim()) {
                return `(empty: ${filePath})`;
            }

            return content.slice(-maxChars);
        } catch (error) {
            return `(failed to read ${filePath}: ${String(error)})`;
        }
    }

    private resolveQemuLogPath(): string | null {
        for (const candidate of QEMU_LOG_CANDIDATES) {
            if (existsSync(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    private async timeoutDiagnostics(context: string): Promise<string> {
        const childStatus = this.child
            ? `pid=${this.child.pid ?? "n/a"} exitCode=${this.child.exitCode ?? "null"} killed=${this.child.killed}`
            : "child=none";

        const snapshot = this.lastSnapshot ? JSON.stringify(this.lastSnapshot, null, 2) : "(no snapshot captured)";
        const qemuLogPath = this.resolveQemuLogPath();

        let runtimeDiag = "(unavailable)";
        try {
            const diag = await this.sendJson<Record<string, unknown>>({ cmd: "runtime_diag" });
            runtimeDiag = JSON.stringify(diag, null, 2);
        } catch (error) {
            runtimeDiag = `(failed to fetch runtime_diag: ${String(error)})`;
        }

        return [
            `Context: ${context}`,
            `Child: ${childStatus}`,
            `Last snapshot: ${snapshot}`,
            `Runtime diag: ${runtimeDiag}`,
            "--- piwork.integration.log (tail) ---",
            this.readTail(INTEGRATION_LOG_PATH),
            "--- piwork.log (tail) ---",
            this.readTail(APP_LOG_PATH),
            "--- qemu.log (tail) ---",
            qemuLogPath ? this.readTail(qemuLogPath) : `(missing: ${QEMU_LOG_CANDIDATES.join(", ")})`,
            "--- end log tail ---",
        ].join("\n");
    }

    async start(): Promise<void> {
        bestEffortStopProcesses();

        mkdirSync(path.dirname(INTEGRATION_LOG_PATH), { recursive: true });
        writeFileSync(INTEGRATION_LOG_PATH, "");
        this.lastSnapshot = null;

        this.logStream = createWriteStream(INTEGRATION_LOG_PATH, { flags: "a" });
        this.child = spawn("pnpm", ["exec", "tauri", "dev"], {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
                FORCE_COLOR: "0",
                NO_COLOR: "1",
            },
            stdio: ["ignore", "pipe", "pipe"],
        });

        if (this.child.stdout && this.logStream) {
            this.child.stdout.pipe(this.logStream);
        }

        if (this.child.stderr && this.logStream) {
            this.child.stderr.pipe(this.logStream);
        }

        await waitFor(
            async () => {
                try {
                    const response = await this.sendCommand({ cmd: "dump_state" });
                    return response === "OK" ? true : null;
                } catch {
                    return null;
                }
            },
            START_TIMEOUT_MS,
            250,
            "test server availability",
            async () => this.timeoutDiagnostics("test server availability"),
        );

        await this.waitForSnapshot(
            (snapshot) => (snapshot.runtime.rpcConnected && !snapshot.runtime.taskSwitching ? snapshot : null),
            SNAPSHOT_TIMEOUT_MS,
            "initial rpc connection",
        );
    }

    async stop(): Promise<void> {
        if (this.child && this.child.exitCode === null) {
            this.child.kill("SIGTERM");
            await sleep(400);
        }

        if (this.child && this.child.exitCode === null) {
            this.child.kill("SIGKILL");
        }

        this.child = null;
        this.lastSnapshot = null;

        if (this.logStream) {
            this.logStream.end();
            this.logStream = null;
        }

        bestEffortStopProcesses();
    }

    async restart(): Promise<void> {
        await this.stop();
        await this.start();
    }

    async sendCommand(command: Record<string, unknown>): Promise<string> {
        return await new Promise<string>((resolve, reject) => {
            const socket = net.createConnection({ host: TEST_SERVER_HOST, port: TEST_SERVER_PORT });
            let buffer = "";
            let settled = false;

            const finish = (fn: () => void) => {
                if (settled) {
                    return;
                }

                settled = true;
                socket.removeAllListeners();
                socket.end();
                fn();
            };

            socket.setTimeout(COMMAND_TIMEOUT_MS);

            socket.on("connect", () => {
                socket.write(`${JSON.stringify(command)}\n`);
            });

            socket.on("data", (chunk: Buffer) => {
                buffer += chunk.toString("utf8");

                const newlineIndex = buffer.indexOf("\n");
                if (newlineIndex === -1) {
                    return;
                }

                const line = buffer.slice(0, newlineIndex).trim();
                finish(() => resolve(line));
            });

            socket.on("timeout", () => {
                finish(() => reject(new Error(`Test server command timed out: ${JSON.stringify(command)}`)));
            });

            socket.on("error", (error) => {
                finish(() => reject(error));
            });

            socket.on("end", () => {
                if (settled) {
                    return;
                }

                const line = buffer.trim();
                if (!line) {
                    finish(() => reject(new Error("Test server closed without response")));
                    return;
                }

                finish(() => resolve(line));
            });
        });
    }

    async sendJson<T>(command: Record<string, unknown>): Promise<T> {
        const response = await this.sendCommand(command);

        if (response.startsWith("ERR:")) {
            throw new Error(response.replace(/^ERR:\s*/, ""));
        }

        try {
            return JSON.parse(response) as T;
        } catch (error) {
            throw new Error(`Invalid JSON response: ${response} (${error})`);
        }
    }

    async snapshot(): Promise<StateSnapshot> {
        const snapshot = await this.sendJson<StateSnapshot>({ cmd: "state_snapshot" });
        this.lastSnapshot = snapshot;
        return snapshot;
    }

    async waitForSnapshot<T>(
        predicate: (snapshot: StateSnapshot) => T | null,
        timeoutMs = SNAPSHOT_TIMEOUT_MS,
        label = "state snapshot predicate",
    ): Promise<T> {
        return await waitFor(
            async () => {
                let snapshot: StateSnapshot;
                try {
                    snapshot = await this.snapshot();
                } catch {
                    return null;
                }

                return predicate(snapshot);
            },
            timeoutMs,
            250,
            label,
            async () => this.timeoutDiagnostics(label),
        );
    }

    async createTask(title: string, workingFolder: string | null): Promise<void> {
        const response = await this.sendCommand({
            cmd: "create_task",
            title,
            workingFolder,
        });

        if (!isOkResponse(response)) {
            throw new Error(`create_task failed: ${response}`);
        }
    }

    async prompt(message: string): Promise<void> {
        const response = await this.sendCommand({ cmd: "prompt", message });
        if (!isOkResponse(response)) {
            throw new Error(`prompt failed: ${response}`);
        }
    }

    async injectMessage(message: string): Promise<void> {
        const response = await this.sendCommand({ cmd: "inject_message", message });
        if (!isOkResponse(response)) {
            throw new Error(`inject_message failed: ${response}`);
        }
    }

    async sendRpc(request: Record<string, unknown>): Promise<void> {
        const response = await this.sendCommand(request);
        if (!isOkResponse(response)) {
            throw new Error(`rpc failed: ${response}`);
        }
    }

    async setFolder(folder: string): Promise<void> {
        const response = await this.sendCommand({ cmd: "set_folder", folder });
        if (!isOkResponse(response)) {
            throw new Error(`set_folder failed: ${response}`);
        }
    }

    async writeWorkingFile(relativePath: string, content: string): Promise<void> {
        const response = await this.sendCommand({
            cmd: "write_working_file",
            relativePath,
            content,
        });

        if (!isOkResponse(response)) {
            throw new Error(`write_working_file failed: ${response}`);
        }
    }

    async openWorkingFolder(taskId: string): Promise<void> {
        const response = await this.sendCommand({
            cmd: "open_working_folder",
            taskId,
        });

        if (!isOkResponse(response)) {
            throw new Error(`open_working_folder failed: ${response}`);
        }
    }

    async previewList(taskId: string): Promise<PreviewListResponse> {
        return await this.sendJson<PreviewListResponse>({ cmd: "preview_list", taskId });
    }

    async previewRead(taskId: string, relativePath: string): Promise<PreviewReadResponse> {
        return await this.sendJson<PreviewReadResponse>({
            cmd: "preview_read",
            taskId,
            relativePath,
        });
    }

    async openPreview(taskId: string, relativePath: string): Promise<void> {
        const response = await this.sendCommand({ cmd: "open_preview", taskId, relativePath });
        if (!isOkResponse(response)) {
            throw new Error(`open_preview failed: ${response}`);
        }
    }

    async artifactList(taskId: string): Promise<ArtifactListResponse> {
        return await this.sendJson<ArtifactListResponse>({ cmd: "artifact_list", taskId });
    }

    async artifactRead(
        taskId: string,
        source: "outputs" | "uploads",
        relativePath: string,
    ): Promise<PreviewReadResponse> {
        return await this.sendJson<PreviewReadResponse>({
            cmd: "artifact_read",
            taskId,
            source,
            relativePath,
        });
    }

    async waitForArtifact(
        taskId: string,
        source: "outputs" | "uploads",
        relativePath: string,
        timeoutMs = 90_000,
    ): Promise<ArtifactFileEntry> {
        return await waitFor(
            async () => {
                try {
                    const artifacts = await this.artifactList(taskId);
                    return artifacts.files.find((file) => file.source === source && file.path === relativePath) ?? null;
                } catch {
                    return null;
                }
            },
            timeoutMs,
            250,
            `artifact ${source}:${relativePath}`,
            async () => this.timeoutDiagnostics(`artifact ${source}:${relativePath}`),
        );
    }

    async waitForHostFile(filePath: string, expectedContent: string, timeoutMs = 60_000): Promise<string> {
        return await waitFor(
            async () => {
                if (!existsSync(filePath)) {
                    return null;
                }

                try {
                    const content = readFileSync(filePath, "utf8");
                    return content === expectedContent ? content : null;
                } catch {
                    return null;
                }
            },
            timeoutMs,
            250,
            `host file ${filePath}`,
            async () => this.timeoutDiagnostics(`host file ${filePath}`),
        );
    }

    async listTasks(): Promise<TaskSummary[]> {
        return await this.sendJson<TaskSummary[]>({ cmd: "task_list" });
    }

    async findTaskByTitle(title: string): Promise<TaskSummary | null> {
        const tasks = await this.listTasks();
        return tasks.find((task) => task.title === title) ?? null;
    }

    async waitForTaskByTitle(title: string, timeoutMs = 15_000): Promise<TaskSummary> {
        return await waitFor(
            async () => {
                const task = await this.findTaskByTitle(title);
                return task ?? null;
            },
            timeoutMs,
            250,
            `task with title ${title}`,
            async () => this.timeoutDiagnostics(`task with title ${title}`),
        );
    }

    async setTask(taskId: string): Promise<void> {
        const response = await this.sendCommand({ cmd: "set_task", taskId });
        if (!isOkResponse(response)) {
            throw new Error(`set_task failed: ${response}`);
        }
    }

    async deleteTask(taskId: string): Promise<void> {
        const response = await this.sendCommand({ cmd: "delete_task", taskId });
        if (!isOkResponse(response)) {
            throw new Error(`delete_task failed: ${response}`);
        }
    }

    async deleteTasksByPrefix(prefix: string): Promise<void> {
        const tasks = await this.listTasks();
        const stale = tasks.filter((task) => task.title.startsWith(prefix));

        for (const task of stale) {
            await this.deleteTask(task.id);
        }
    }

    async waitForTaskSettled(taskId: string, timeoutMs = 120_000): Promise<StateSnapshot> {
        return await this.waitForSnapshot((snapshot) => {
            if (!snapshot.runtime.rpcConnected || snapshot.runtime.taskSwitching) {
                return null;
            }

            if (snapshot.task.currentTaskId !== taskId) {
                return null;
            }

            return snapshot;
        }, timeoutMs);
    }

    logPath(): string {
        return INTEGRATION_LOG_PATH;
    }
}
