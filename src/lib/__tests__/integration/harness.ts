import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const LOG_PATH = path.join(REPO_ROOT, "tmp/dev/piwork.integration.log");

const TEST_SERVER_HOST = "127.0.0.1";
const TEST_SERVER_PORT = 19385;

const START_TIMEOUT_MS = 180_000;
const SNAPSHOT_TIMEOUT_MS = 90_000;
const COMMAND_TIMEOUT_MS = 8_000;

interface TaskSummary {
    id: string;
    title: string;
    workingFolder: string | null;
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
        authProfile: string;
    };
    conversation: {
        messageCount: number;
        isAgentRunning: boolean;
        hasError: boolean;
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
        loading: boolean;
        error: string | null;
        selectedModelId: string;
    };
    runtimeDebug: {
        activeTaskId: string | null;
        currentCwd: string | null;
        workingFolderRelative: string | null;
        mismatchVisible: boolean;
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
): Promise<T> {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        const result = await fn();
        if (result !== null) {
            return result;
        }

        await sleep(intervalMs);
    }

    throw new Error(`Timed out waiting for ${label}`);
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

    async start(): Promise<void> {
        bestEffortStopProcesses();

        mkdirSync(path.dirname(LOG_PATH), { recursive: true });
        writeFileSync(LOG_PATH, "");

        this.logStream = createWriteStream(LOG_PATH, { flags: "a" });
        this.child = spawn("mise", ["run", "tauri-dev"], {
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
        );

        await this.waitForSnapshot(
            (snapshot) => (snapshot.runtime.rpcConnected && !snapshot.runtime.taskSwitching ? snapshot : null),
            SNAPSHOT_TIMEOUT_MS,
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
        return await this.sendJson<StateSnapshot>({ cmd: "state_snapshot" });
    }

    async waitForSnapshot<T>(
        predicate: (snapshot: StateSnapshot) => T | null,
        timeoutMs = SNAPSHOT_TIMEOUT_MS,
    ): Promise<T> {
        return await waitFor(
            async () => {
                try {
                    const snapshot = await this.snapshot();
                    return predicate(snapshot);
                } catch {
                    return null;
                }
            },
            timeoutMs,
            250,
            "state snapshot predicate",
        );
    }

    async createTask(title: string, workingFolder: string | null): Promise<void> {
        const response = await this.sendCommand({
            cmd: "create_task",
            title,
            workingFolder,
        });

        if (response !== "OK") {
            throw new Error(`create_task failed: ${response}`);
        }
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
        );
    }

    async setTask(taskId: string): Promise<void> {
        const response = await this.sendCommand({ cmd: "set_task", taskId });
        if (response !== "OK") {
            throw new Error(`set_task failed: ${response}`);
        }
    }

    async deleteTask(taskId: string): Promise<void> {
        const response = await this.sendCommand({ cmd: "delete_task", taskId });
        if (response !== "OK") {
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

    logPath(): string {
        return LOG_PATH;
    }
}
