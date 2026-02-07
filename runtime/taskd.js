#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

const RPC_PORT = Number.parseInt(process.env.PIWORK_RPC_PORT || "19384", 10);
const NODE_BIN = process.env.PIWORK_NODE_BIN || "/usr/bin/node";
const PI_CLI = process.env.PIWORK_PI_CLI || "/opt/pi/dist/cli.js";
const SESSIONS_ROOT = process.env.PIWORK_TASKD_SESSIONS_ROOT || "/sessions";
const TASKS_ROOT = process.env.PIWORK_TASKD_TASKS_ROOT || path.dirname(SESSIONS_ROOT);
const WORKSPACE_ROOT = process.env.PIWORK_WORKSPACE_ROOT || "";
const INITIAL_TASK_ID = process.env.PIWORK_INITIAL_TASK_ID || "";
const DEFAULT_PROVIDER = process.env.PIWORK_DEFAULT_PROVIDER || "anthropic";
const DEFAULT_MODEL = process.env.PIWORK_DEFAULT_MODEL || "claude-opus-4-5";
const DEFAULT_THINKING_LEVEL = process.env.PIWORK_DEFAULT_THINKING || "high";
const LEGACY_TASK_ID = "__legacy__";
const CHILD_COMMAND_TIMEOUT_MS = 10_000;
const SYSTEM_BASH_TIMEOUT_MS = 10_000;
const STOP_GRACE_PERIOD_MS = 1_200;
const DIAG_HISTORY_LIMIT = 200;
const HOST_TRACE_ENABLED = process.env.PIWORK_TASKD_TRACE !== "0";

const IDEMPOTENT_REQUESTS = new Set(["create_or_open_task", "switch_task", "stop_task"]);

const tasks = new Map();
const requestCache = new Map();
const hostRequestHistory = [];
const childCommandHistory = [];

let activeTaskId = null;
let hostSocket = null;

let defaults = {
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    thinkingLevel: DEFAULT_THINKING_LEVEL,
};

let workspaceRootReal = undefined;

function log(message) {
    console.log(`[taskd] ${message}`);
}

function nowIso() {
    return new Date().toISOString();
}

function pushBoundedHistory(buffer, entry, limit = DIAG_HISTORY_LIMIT) {
    buffer.push(entry);
    if (buffer.length > limit) {
        buffer.splice(0, buffer.length - limit);
    }
}

function summarizeError(error) {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === "string") {
        return error;
    }

    return String(error);
}

function traceRequestTaskId(request) {
    if (!isRecord(request) || !isRecord(request.payload)) {
        return activeTaskId;
    }

    if (typeof request.payload.taskId === "string" && request.payload.taskId.length > 0) {
        return request.payload.taskId;
    }

    return activeTaskId;
}

function traceHostReceived(request) {
    const entry = {
        timestamp: nowIso(),
        direction: "in",
        id: request.id,
        type: request.type,
        taskId: traceRequestTaskId(request),
    };

    pushBoundedHistory(hostRequestHistory, entry);

    if (HOST_TRACE_ENABLED) {
        log(`[host] <- ${request.type} id=${request.id} task=${entry.taskId ?? "none"}`);
    }
}

function traceHostCompleted(request, ok, details = {}) {
    const receivedAt = Number.isFinite(request.receivedAtMs) ? request.receivedAtMs : Date.now();
    const durationMs = Math.max(0, Date.now() - receivedAt);
    const entry = {
        timestamp: nowIso(),
        direction: "out",
        id: request.id,
        type: request.type,
        taskId: traceRequestTaskId(request),
        ok,
        durationMs,
        ...details,
    };

    pushBoundedHistory(hostRequestHistory, entry);

    if (HOST_TRACE_ENABLED) {
        const summary = ok ? "ok" : `error=${details.code ?? "unknown"}`;
        log(`[host] -> ${request.type} id=${request.id} ${summary} ${durationMs}ms`);
    }
}

function traceChildCompleted(task, commandType, commandId, startedAtMs, ok, details = {}) {
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    const entry = {
        timestamp: nowIso(),
        taskId: task.taskId,
        commandType,
        commandId,
        ok,
        durationMs,
        ...details,
    };

    pushBoundedHistory(childCommandHistory, entry);

    if (HOST_TRACE_ENABLED) {
        const summary = ok ? "ok" : `error=${details.error ?? details.code ?? "unknown"}`;
        log(`[child] ${task.taskId} ${commandType} id=${commandId} ${summary} ${durationMs}ms`);
    }
}

function responseErrorCode(response) {
    if (!isRecord(response) || !isRecord(response.error)) {
        return undefined;
    }

    return typeof response.error.code === "string" ? response.error.code : undefined;
}

function randomId(prefix) {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateTaskId(taskId) {
    return (
        typeof taskId === "string" &&
        taskId.length > 0 &&
        !taskId.includes("/") &&
        !taskId.includes("\\") &&
        !taskId.includes("..")
    );
}

function createWorkspacePolicyError(message, details = {}) {
    const error = new Error(message);
    error.code = "WORKSPACE_POLICY_VIOLATION";
    error.details = details;
    return error;
}

function normalizeRelativeWorkingFolder(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value !== "string") {
        throw createWorkspacePolicyError("workingFolderRelative must be a string", {});
    }

    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === ".") {
        return "";
    }

    if (trimmed.includes("\0") || trimmed.includes("\\") || trimmed.startsWith("/")) {
        throw createWorkspacePolicyError("workingFolderRelative is invalid", {
            reason: "invalid_path_format",
        });
    }

    const normalized = path.posix.normalize(trimmed);
    if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
        throw createWorkspacePolicyError("workingFolderRelative escapes workspace root", {
            reason: "path_escape",
        });
    }

    return normalized === "." ? "" : normalized;
}

function isPathWithin(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ensureNoSymlinkComponents(root, candidate) {
    const relative = path.relative(root, candidate);
    if (!relative || relative === ".") {
        return;
    }

    let current = root;
    for (const segment of relative.split(path.sep)) {
        if (!segment || segment === ".") {
            continue;
        }

        current = path.join(current, segment);
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
            throw createWorkspacePolicyError("working folder path must not include symlink components", {
                path: current,
            });
        }
    }
}

function getWorkspaceRootReal() {
    if (workspaceRootReal !== undefined) {
        return workspaceRootReal;
    }

    if (!WORKSPACE_ROOT) {
        workspaceRootReal = null;
        return workspaceRootReal;
    }

    try {
        const stat = fs.lstatSync(WORKSPACE_ROOT);
        if (stat.isSymbolicLink()) {
            throw createWorkspacePolicyError("workspace root must not be a symlink", {
                path: WORKSPACE_ROOT,
            });
        }

        const resolved = fs.realpathSync(WORKSPACE_ROOT);
        const resolvedStat = fs.statSync(resolved);
        if (!resolvedStat.isDirectory()) {
            throw createWorkspacePolicyError("workspace root must be a directory", {
                path: resolved,
            });
        }

        workspaceRootReal = resolved;
    } catch (error) {
        log(`workspace root unavailable (${WORKSPACE_ROOT}): ${String(error)}`);
        workspaceRootReal = null;
    }

    return workspaceRootReal;
}

function resolveTaskCwd(task) {
    const relativePath = normalizeRelativeWorkingFolder(task.requestedWorkingFolderRelative);
    task.requestedWorkingFolderRelative = relativePath;

    if (relativePath === null) {
        return task.workDir;
    }

    const workspaceRoot = getWorkspaceRootReal();
    if (!workspaceRoot) {
        log(`task ${task.taskId} has scoped folder but workspace root is unavailable; falling back to ${task.workDir}`);
        return task.workDir;
    }

    const relativeOsPath = relativePath.split("/").join(path.sep);
    const candidate = relativeOsPath.length > 0 ? path.join(workspaceRoot, relativeOsPath) : workspaceRoot;

    let candidateReal;
    try {
        candidateReal = fs.realpathSync(candidate);
    } catch {
        throw createWorkspacePolicyError("working folder does not exist in workspace root", {
            relativePath,
        });
    }

    if (!isPathWithin(workspaceRoot, candidateReal)) {
        throw createWorkspacePolicyError("working folder escapes workspace root", {
            relativePath,
        });
    }

    const stat = fs.statSync(candidateReal);
    if (!stat.isDirectory()) {
        throw createWorkspacePolicyError("working folder must be a directory", {
            relativePath,
        });
    }

    ensureNoSymlinkComponents(workspaceRoot, candidateReal);
    return candidateReal;
}

function requestFingerprint(request) {
    return JSON.stringify({
        type: request.type,
        payload: request.payload,
    });
}

function writeJson(payload) {
    if (!hostSocket || hostSocket.destroyed || !hostSocket.writable) {
        return;
    }

    hostSocket.write(`${JSON.stringify(payload)}\n`);
}

function emitEvent(event, taskId, payload = {}) {
    writeJson({
        type: "event",
        event,
        timestamp: nowIso(),
        taskId,
        payload,
    });
}

function cacheIdempotentResponse(request, response) {
    if (!request.id || !IDEMPOTENT_REQUESTS.has(request.type)) {
        return;
    }

    requestCache.set(request.id, {
        fingerprint: requestFingerprint(request),
        response,
    });
}

function maybeHandleDuplicateIdempotentRequest(request) {
    if (!request.id || !IDEMPOTENT_REQUESTS.has(request.type)) {
        return false;
    }

    const cached = requestCache.get(request.id);
    if (!cached) {
        return false;
    }

    if (cached.fingerprint !== requestFingerprint(request)) {
        const response = {
            id: request.id,
            ok: false,
            error: {
                code: "INVALID_REQUEST",
                message: "Duplicate request id with different payload",
                retryable: false,
                details: {},
            },
        };
        writeJson(response);
        traceHostCompleted(request, false, {
            code: "INVALID_REQUEST",
            duplicate: true,
        });
        return true;
    }

    writeJson(cached.response);
    traceHostCompleted(request, cached.response.ok === true, {
        duplicate: true,
        code: responseErrorCode(cached.response),
    });
    return true;
}

function sendV2Success(request, result) {
    const response = {
        id: request.id,
        ok: true,
        result,
    };

    cacheIdempotentResponse(request, response);
    writeJson(response);
    traceHostCompleted(request, true, {});
    return response;
}

function sendV2Error(request, code, message, retryable = false, details = {}) {
    const response = {
        id: request.id,
        ok: false,
        error: {
            code,
            message,
            retryable,
            details,
        },
    };

    cacheIdempotentResponse(request, response);
    writeJson(response);
    traceHostCompleted(request, false, { code, message, retryable });
    return response;
}

function buildTask(taskId, options = {}) {
    const sessionDir = path.join(SESSIONS_ROOT, taskId);
    const sessionFile = path.join(sessionDir, "session.json");
    const taskDir = path.join(TASKS_ROOT, taskId);
    const outputsDir = path.join(taskDir, "outputs");
    const uploadsDir = path.join(taskDir, "uploads");

    return {
        taskId,
        state: "missing",
        provider: typeof options.provider === "string" ? options.provider : defaults.provider,
        model: typeof options.model === "string" ? options.model : defaults.model,
        thinkingLevel:
            typeof options.thinkingLevel === "string" ? options.thinkingLevel : defaults.thinkingLevel,
        requestedWorkingFolder:
            typeof options.workingFolder === "string" ? options.workingFolder : null,
        requestedWorkingFolderRelative:
            typeof options.workingFolderRelative === "string" ? options.workingFolderRelative : null,
        sessionFile,
        taskDir,
        outputsDir,
        uploadsDir,
        workDir: outputsDir,
        currentCwd: outputsDir,
        child: null,
        pendingChildRequests: new Map(),
        stopping: false,
        promptInFlight: false,
        promptCommandId: null,
        lastChildOutputAt: null,
        lastChildError: null,
    };
}

function serializeTask(task) {
    return {
        taskId: task.taskId,
        state: task.state,
        provider: task.provider,
        model: task.model,
        thinkingLevel: task.thinkingLevel,
        promptInFlight: task.promptInFlight,
        sessionFile: task.sessionFile,
        taskDir: task.taskDir,
        outputsDir: task.outputsDir,
        uploadsDir: task.uploadsDir,
        workDir: task.workDir,
        currentCwd: task.currentCwd,
        workingFolderRelative: task.requestedWorkingFolderRelative,
        childPid: task.child?.pid ?? null,
        childAlive: Boolean(task.child && !task.child.killed),
        pendingChildRequestCount: task.pendingChildRequests.size,
        lastChildOutputAt: task.lastChildOutputAt,
        lastChildError: task.lastChildError,
    };
}

function updateTaskConfig(task, options = {}) {
    if (typeof options.provider === "string") {
        task.provider = options.provider;
    }
    if (typeof options.model === "string") {
        task.model = options.model;
    }
    if (typeof options.thinkingLevel === "string") {
        task.thinkingLevel = options.thinkingLevel;
    }
    if (Object.prototype.hasOwnProperty.call(options, "workingFolder")) {
        task.requestedWorkingFolder = typeof options.workingFolder === "string" ? options.workingFolder : null;
    }
    if (Object.prototype.hasOwnProperty.call(options, "workingFolderRelative")) {
        task.requestedWorkingFolderRelative =
            typeof options.workingFolderRelative === "string" ? options.workingFolderRelative : null;
    }
}

function rejectPendingChildRequests(task, reason) {
    for (const [, pending] of Array.from(task.pendingChildRequests.entries())) {
        pending.reject(new Error(reason));
    }
}

function extractChunkFromPayload(payload) {
    if (!isRecord(payload)) {
        return null;
    }

    if (payload.type === "tool_execution_update" && typeof payload.output === "string") {
        return payload.output;
    }

    if (payload.type !== "message_update") {
        return null;
    }

    const event = payload.assistantMessageEvent;
    if (!isRecord(event) || typeof event.type !== "string") {
        return null;
    }

    if (
        (event.type === "text_delta" ||
            event.type === "thinking_delta" ||
            event.type === "toolcall_delta") &&
        typeof event.delta === "string"
    ) {
        return event.delta;
    }

    return null;
}

function forwardChildPayload(task, payload) {
    if (task.taskId === activeTaskId) {
        writeJson(payload);
    }

    const chunk = extractChunkFromPayload(payload);
    if (chunk && chunk.length > 0) {
        emitEvent("agent_output", task.taskId, { chunk });
    }

    if (payload.type === "agent_end") {
        task.promptInFlight = false;
        task.promptCommandId = null;

        const usage = isRecord(payload.usage) ? payload.usage : undefined;
        emitEvent("agent_end", task.taskId, usage ? { usage } : {});
    }

    if (payload.type === "response" && task.promptCommandId && payload.id === task.promptCommandId) {
        if (payload.success === false) {
            task.promptInFlight = false;
            task.promptCommandId = null;
            emitEvent("task_error", task.taskId, {
                code: "INTERNAL_ERROR",
                message: typeof payload.error === "string" ? payload.error : "prompt rejected",
            });
        }
    }
}

function handleChildOutputLine(task, line) {
    const trimmed = line.trim();
    if (!trimmed) {
        return;
    }

    task.lastChildOutputAt = nowIso();

    let payload;
    try {
        payload = JSON.parse(trimmed);
    } catch {
        task.lastChildError = `non-json-output: ${trimmed.slice(0, 200)}`;
        log(`task ${task.taskId} emitted non-JSON line: ${trimmed}`);
        return;
    }

    if (payload.type === "response" && typeof payload.id === "string") {
        const pending = task.pendingChildRequests.get(payload.id);
        if (pending) {
            pending.resolve(payload);
            return;
        }
    }

    forwardChildPayload(task, payload);
}

function handleChildExit(task, code, signal) {
    const reason = `pi exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;

    rejectPendingChildRequests(task, reason);

    task.child = null;
    task.promptInFlight = false;
    task.promptCommandId = null;
    task.lastChildError = reason;

    if (task.stopping) {
        task.stopping = false;
        task.state = "stopped";
        return;
    }

    task.state = "errored";

    if (activeTaskId === task.taskId) {
        activeTaskId = null;
    }

    emitEvent("task_error", task.taskId, {
        code: "PI_PROCESS_DEAD",
        message: reason,
    });
}

async function spawnTaskProcess(task) {
    if (task.child && !task.child.killed) {
        return;
    }

    fs.mkdirSync(path.dirname(task.sessionFile), { recursive: true });
    fs.mkdirSync(task.taskDir, { recursive: true });
    fs.mkdirSync(task.outputsDir, { recursive: true });
    fs.mkdirSync(task.uploadsDir, { recursive: true });

    try {
        fs.chmodSync(task.outputsDir, 0o755);
        fs.chmodSync(task.uploadsDir, 0o555);
    } catch {
        // Best-effort permissions for 9p mounts.
    }

    const taskCwd = resolveTaskCwd(task);
    const args = [PI_CLI, "--mode", "rpc", "--session", task.sessionFile];

    const child = spawn(NODE_BIN, args, {
        cwd: taskCwd,
        env: {
            ...process.env,
            PI_WORKING_DIR: taskCwd,
        },
        stdio: ["pipe", "pipe", "pipe"],
    });

    task.child = child;
    task.currentCwd = taskCwd;
    task.stopping = false;
    task.promptInFlight = false;
    task.promptCommandId = null;
    task.lastChildOutputAt = null;
    task.lastChildError = null;

    const stdout = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
    });

    stdout.on("line", (line) => {
        handleChildOutputLine(task, line);
    });

    child.stderr.on("data", (chunk) => {
        const text = chunk.toString().trim();
        if (text.length > 0) {
            task.lastChildError = text.slice(0, 500);
            log(`task ${task.taskId} stderr: ${text}`);
        }
    });

    child.on("exit", (code, signal) => {
        handleChildExit(task, code, signal);
    });

    await new Promise((resolve, reject) => {
        const onError = (error) => {
            child.off("spawn", onSpawn);
            reject(error);
        };

        const onSpawn = () => {
            child.off("error", onError);
            resolve();
        };

        child.once("error", onError);
        child.once("spawn", onSpawn);
    });

    task.state = "ready";

    if (task.provider && task.model) {
        void sendToTask(task, {
            type: "set_model",
            provider: task.provider,
            modelId: task.model,
        }).catch((error) => {
            log(`task ${task.taskId} set_model failed: ${String(error)}`);
        });
    }
}

async function stopTaskProcess(task) {
    if (!task.child || task.child.killed) {
        task.child = null;
        task.state = "stopped";
        task.promptInFlight = false;
        task.promptCommandId = null;
        return;
    }

    const child = task.child;
    task.stopping = true;

    await new Promise((resolve) => {
        let settled = false;

        const settle = () => {
            if (settled) {
                return;
            }
            settled = true;
            resolve();
        };

        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            settle();
        }, STOP_GRACE_PERIOD_MS);

        child.once("exit", () => {
            clearTimeout(timer);
            settle();
        });

        child.kill("SIGTERM");
    });

    task.child = null;
    task.state = "stopped";
    task.promptInFlight = false;
    task.promptCommandId = null;
}

function sendToTask(task, command, timeoutMs = CHILD_COMMAND_TIMEOUT_MS) {
    if (!task.child || !task.child.stdin || task.child.stdin.destroyed) {
        return Promise.reject(new Error("task process unavailable"));
    }

    const id = typeof command.id === "string" ? command.id : randomId("child");
    const payload = { ...command, id };
    const commandType = typeof payload.type === "string" ? payload.type : "unknown";
    const startedAtMs = Date.now();

    if (HOST_TRACE_ENABLED) {
        log(
            `[child] ${task.taskId} ${commandType} id=${id} start (timeout=${timeoutMs}ms, pending=${task.pendingChildRequests.size})`,
        );
    }

    return new Promise((resolve, reject) => {
        let settled = false;

        const settleResolve = (responsePayload) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
            task.pendingChildRequests.delete(id);
            traceChildCompleted(task, commandType, id, startedAtMs, true, {
                pendingChildRequestCount: task.pendingChildRequests.size,
            });
            resolve(responsePayload);
        };

        const settleReject = (error, code = null) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
            task.pendingChildRequests.delete(id);

            const errorMessage = summarizeError(error);
            task.lastChildError = `${commandType}: ${errorMessage}`;
            traceChildCompleted(task, commandType, id, startedAtMs, false, {
                code,
                error: errorMessage,
                pendingChildRequestCount: task.pendingChildRequests.size,
            });

            reject(error instanceof Error ? error : new Error(errorMessage));
        };

        const timeout = setTimeout(() => {
            settleReject(new Error(`Task command timed out: ${commandType}`), "CHILD_COMMAND_TIMEOUT");
        }, timeoutMs);

        task.pendingChildRequests.set(id, {
            resolve: settleResolve,
            reject: settleReject,
            timeout,
            commandType,
            startedAtMs,
        });

        task.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
            if (!error) {
                return;
            }

            settleReject(error, "CHILD_STDIN_WRITE_FAILED");
        });
    });
}

async function createOrOpenTaskInternal(taskId, options) {
    let task = tasks.get(taskId);
    let mode = "created";

    if (!task) {
        task = buildTask(taskId, options);
        tasks.set(taskId, task);
    } else {
        updateTaskConfig(task, options);

        if (task.state === "ready" || task.state === "idle" || task.state === "active") {
            const error = new Error("task already open");
            error.code = "TASK_NOT_READY";
            throw error;
        }

        mode = task.state === "errored" ? "recovered" : "resumed";
    }

    await spawnTaskProcess(task);

    if (task.state !== "active") {
        task.state = "ready";
    }

    return {
        task,
        mode,
    };
}

function switchTaskInternal(taskId, emitEvents = true) {
    const target = tasks.get(taskId);
    if (!target) {
        const error = new Error("task not found");
        error.code = "TASK_NOT_FOUND";
        throw error;
    }

    if (!["ready", "idle", "active"].includes(target.state)) {
        const error = new Error("task is not ready");
        error.code = "TASK_NOT_READY";
        throw error;
    }

    if (emitEvents) {
        emitEvent("task_switch_started", taskId, {});
    }

    if (activeTaskId && activeTaskId !== taskId) {
        const previous = tasks.get(activeTaskId);
        if (previous && previous.state === "active") {
            previous.state = "idle";
        }
    }

    activeTaskId = taskId;
    target.state = "active";

    if (emitEvents) {
        emitEvent("task_ready", taskId, {});
    }
}

async function ensureLegacyActiveTask() {
    const preferredTaskId = validateTaskId(INITIAL_TASK_ID) ? INITIAL_TASK_ID : LEGACY_TASK_ID;

    if (!tasks.has(preferredTaskId)) {
        await createOrOpenTaskInternal(preferredTaskId, defaults);
    }

    const task = tasks.get(preferredTaskId);
    if (!task) {
        throw new Error("failed to create legacy task");
    }

    if (task.state === "stopped" || task.state === "errored" || task.state === "missing") {
        await createOrOpenTaskInternal(preferredTaskId, defaults);
    }

    switchTaskInternal(preferredTaskId, false);
    return tasks.get(preferredTaskId);
}

async function startPromptOnActiveTask(message) {
    if (typeof message !== "string" || message.trim().length === 0) {
        const error = new Error("message is required");
        error.code = "INVALID_REQUEST";
        throw error;
    }

    let task = activeTaskId ? tasks.get(activeTaskId) : null;

    if (!task) {
        task = await ensureLegacyActiveTask();
    }

    if (!task || task.state !== "active") {
        const error = new Error("no active task");
        error.code = "TASK_NOT_READY";
        throw error;
    }

    if (task.promptInFlight) {
        const error = new Error("prompt already running for active task");
        error.code = "TASK_NOT_READY";
        throw error;
    }

    const commandId = randomId("prompt");
    task.promptInFlight = true;
    task.promptCommandId = commandId;

    await sendToTask(task, {
        id: commandId,
        type: "prompt",
        message,
    }).catch((error) => {
        task.promptInFlight = false;
        task.promptCommandId = null;
        throw error;
    });

    return task;
}

function inspectDirectory(targetPath) {
    try {
        const stats = fs.statSync(targetPath);
        return stats.isDirectory() ? "directory" : "not_directory";
    } catch {
        return "missing";
    }
}

function getActiveTaskCwd() {
    const activeTask = activeTaskId ? tasks.get(activeTaskId) : null;
    if (!activeTask || typeof activeTask.currentCwd !== "string" || activeTask.currentCwd.length === 0) {
        return null;
    }

    if (inspectDirectory(activeTask.currentCwd) !== "directory") {
        return null;
    }

    return activeTask.currentCwd;
}

function resolveSystemBashCwd(rawCwd) {
    if (rawCwd === null || rawCwd === undefined) {
        return { cwd: getActiveTaskCwd() };
    }

    if (typeof rawCwd !== "string") {
        return { error: "cwd must be a string" };
    }

    const trimmed = rawCwd.trim();
    if (trimmed.length === 0) {
        return { cwd: null };
    }

    const activeTaskCwd = getActiveTaskCwd();
    const baseCwd = activeTaskCwd || process.cwd();
    const resolved = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(baseCwd, trimmed);
    const directoryState = inspectDirectory(resolved);

    if (directoryState === "not_directory") {
        return { error: "cwd must be a directory" };
    }

    if (directoryState === "missing") {
        return { error: "cwd does not exist" };
    }

    return { cwd: resolved };
}

function readSystemBashString(request, keys) {
    for (const key of keys) {
        const value = request.payload[key];
        if (typeof value === "string") {
            return value;
        }
    }

    return null;
}

function parseSystemBashRequest(request) {
    const command = readSystemBashString(request, ["command"]) || "";
    if (!command.trim()) {
        return { error: "command is required" };
    }

    const requestedCwd = readSystemBashString(request, ["cwd", "workingDirectory"]);
    const cwdResult = resolveSystemBashCwd(requestedCwd);
    if (cwdResult.error) {
        return { error: cwdResult.error };
    }

    return {
        command,
        cwd: cwdResult.cwd,
    };
}

async function runSystemBash(command, cwd = null) {
    return await new Promise((resolve) => {
        const child = spawn("/bin/sh", ["-lc", command], {
            cwd: cwd || undefined,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";
        let timedOut = false;
        let settled = false;

        const finish = (result) => {
            if (settled) {
                return;
            }

            settled = true;
            resolve(result);
        };

        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, SYSTEM_BASH_TIMEOUT_MS);

        child.stdout.on("data", (chunk) => {
            output += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            output += chunk.toString();
        });

        child.on("error", (error) => {
            clearTimeout(timeout);
            finish({
                output: `${output}${String(error)}`,
                exitCode: 1,
                timedOut: false,
            });
        });

        child.on("close", (code) => {
            clearTimeout(timeout);
            finish({
                output,
                exitCode: timedOut ? 124 : typeof code === "number" ? code : 1,
                timedOut,
            });
        });
    });
}

function parseRequest(raw) {
    if (!isRecord(raw)) {
        return {
            request: null,
            id: null,
            error: "Request must be an object",
        };
    }

    const id = typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id : null;
    if (!id) {
        return {
            request: null,
            id: null,
            error: "Request id is required",
        };
    }

    const type = typeof raw.type === "string" ? raw.type.trim() : "";
    if (!type) {
        return {
            request: null,
            id,
            error: "Request type is required",
        };
    }

    if (!isRecord(raw.payload)) {
        return {
            request: null,
            id,
            error: "Request payload must be an object",
        };
    }

    return {
        request: {
            id,
            type,
            payload: { ...raw.payload },
        },
        id,
        error: null,
    };
}

function pickTaskNotReadyRetryable(code) {
    return code === "TASK_NOT_READY";
}

async function handleV2CreateOrOpenTask(request) {
    const taskId = typeof request.payload.taskId === "string" ? request.payload.taskId : null;

    if (!validateTaskId(taskId)) {
        return sendV2Error(request, "INVALID_REQUEST", "taskId is required", false, {});
    }

    try {
        const { task, mode } = await createOrOpenTaskInternal(taskId, request.payload);
        return sendV2Success(request, {
            taskId: task.taskId,
            state: task.state,
            mode,
        });
    } catch (error) {
        const code = typeof error?.code === "string" ? error.code : "INTERNAL_ERROR";
        const message = error instanceof Error ? error.message : String(error);
        const details = isRecord(error?.details) ? error.details : {};
        return sendV2Error(request, code, message, pickTaskNotReadyRetryable(code), details);
    }
}

function handleV2SwitchTask(request) {
    const taskId = typeof request.payload.taskId === "string" ? request.payload.taskId : null;

    if (!validateTaskId(taskId)) {
        return sendV2Error(request, "INVALID_REQUEST", "taskId is required", false, {});
    }

    try {
        const task = tasks.get(taskId);
        if (!task) {
            return sendV2Error(request, "TASK_NOT_FOUND", "task not found", false, {});
        }

        if (!["ready", "idle", "active"].includes(task.state)) {
            return sendV2Error(request, "TASK_NOT_READY", "task is not ready", true, {});
        }

        const response = sendV2Success(request, {
            status: "switching",
            taskId,
        });

        switchTaskInternal(taskId, true);
        return response;
    } catch (error) {
        const code = typeof error?.code === "string" ? error.code : "INTERNAL_ERROR";
        const message = error instanceof Error ? error.message : String(error);
        return sendV2Error(request, code, message, pickTaskNotReadyRetryable(code), {});
    }
}

async function handleV2Prompt(request) {
    const message = typeof request.payload.message === "string" ? request.payload.message : null;
    const promptId = typeof request.payload.promptId === "string" ? request.payload.promptId : randomId("prompt");

    if (!message) {
        return sendV2Error(request, "INVALID_REQUEST", "message is required", false, {});
    }

    const task = activeTaskId ? tasks.get(activeTaskId) : null;
    if (!task || task.state !== "active") {
        return sendV2Error(request, "TASK_NOT_READY", "no active task", true, {});
    }

    const response = sendV2Success(request, {
        accepted: true,
        taskId: task.taskId,
        promptId,
    });

    startPromptOnActiveTask(message).catch((error) => {
        const messageText = error instanceof Error ? error.message : String(error);
        emitEvent("task_error", task.taskId, {
            code: "INTERNAL_ERROR",
            message: messageText,
        });
    });

    return response;
}

function taskdStatePayload() {
    return {
        activeTaskId,
        tasks: Array.from(tasks.values()).map(serializeTask),
    };
}

function runtimeDiagTaskPayload(task) {
    const pendingChildRequests = Array.from(task.pendingChildRequests.entries()).map(([id, pending]) => {
        const startedAtMs = Number.isFinite(pending.startedAtMs) ? pending.startedAtMs : null;
        const ageMs = startedAtMs === null ? null : Math.max(0, Date.now() - startedAtMs);

        return {
            id,
            commandType: typeof pending.commandType === "string" ? pending.commandType : "unknown",
            startedAtMs,
            ageMs,
        };
    });

    return {
        ...serializeTask(task),
        pendingChildRequests,
    };
}

function runtimeDiagPayload() {
    return {
        timestamp: nowIso(),
        pid: process.pid,
        activeTaskId,
        defaults: { ...defaults },
        workspaceRootConfigured: WORKSPACE_ROOT || null,
        workspaceRootResolved: getWorkspaceRootReal(),
        hostConnected: Boolean(hostSocket && !hostSocket.destroyed && hostSocket.writable),
        requestCacheSize: requestCache.size,
        taskCount: tasks.size,
        tasks: Array.from(tasks.values()).map(runtimeDiagTaskPayload),
        hostRequestHistory: [...hostRequestHistory],
        childCommandHistory: [...childCommandHistory],
    };
}

function handleV2RuntimeDiag(request) {
    return sendV2Success(request, runtimeDiagPayload());
}

async function ensureActiveTaskForPiCommand() {
    let task = activeTaskId ? tasks.get(activeTaskId) : null;

    if (!task) {
        task = await ensureLegacyActiveTask();
    }

    if (!task) {
        const error = new Error("no active task");
        error.code = "TASK_NOT_READY";
        throw error;
    }

    if (!task.child || !task.child.stdin || task.child.stdin.destroyed) {
        const error = new Error("active task process unavailable");
        error.code = "TASK_NOT_READY";
        throw error;
    }

    return task;
}

function parsePiResponseError(response, fallback) {
    if (isRecord(response) && typeof response.error === "string" && response.error.trim().length > 0) {
        return response.error;
    }

    return fallback;
}

async function fetchAvailableModelsFromPi() {
    const task = await ensureActiveTaskForPiCommand();
    const response = await sendToTask(task, {
        type: "get_available_models",
    });

    if (!isRecord(response) || response.success !== true) {
        const error = new Error(parsePiResponseError(response, "get_available_models failed"));
        error.code = "INTERNAL_ERROR";
        throw error;
    }

    const data = isRecord(response.data) ? response.data : {};
    return Array.isArray(data.models) ? data.models : [];
}

async function setModelOnActiveTask(provider, modelId) {
    const task = await ensureActiveTaskForPiCommand();
    const response = await sendToTask(task, {
        type: "set_model",
        provider,
        modelId,
    });

    if (!isRecord(response) || response.success !== true) {
        const error = new Error(parsePiResponseError(response, "set_model failed"));
        error.code = "INTERNAL_ERROR";
        throw error;
    }

    const data = isRecord(response.data) ? response.data : {};
    const resolvedProvider = typeof data.provider === "string" ? data.provider : provider;
    const resolvedModelId = typeof data.id === "string" ? data.id : modelId;
    const resolvedModelName = typeof data.name === "string" ? data.name : resolvedModelId;

    defaults = {
        ...defaults,
        provider: resolvedProvider,
        model: resolvedModelId,
    };

    task.provider = resolvedProvider;
    task.model = resolvedModelId;

    return {
        id: resolvedModelId,
        name: resolvedModelName,
        provider: resolvedProvider,
    };
}

async function forwardExtensionUiResponseToPi(payload) {
    if (!isRecord(payload)) {
        const error = new Error("payload is required");
        error.code = "INVALID_REQUEST";
        throw error;
    }

    if (typeof payload.id !== "string" || payload.id.trim().length === 0) {
        const error = new Error("extension UI response id is required");
        error.code = "INVALID_REQUEST";
        throw error;
    }

    const task = await ensureActiveTaskForPiCommand();
    const response = await sendToTask(task, {
        ...payload,
        type: "extension_ui_response",
    });

    if (!isRecord(response) || response.success !== true) {
        const error = new Error(parsePiResponseError(response, "extension_ui_response failed"));
        error.code = "INTERNAL_ERROR";
        throw error;
    }

    return isRecord(response.data) ? response.data : {};
}

function parseSetModelRequest(request) {
    const provider = typeof request.payload.provider === "string" ? request.payload.provider.trim() : "";
    const modelValue =
        typeof request.payload.modelId === "string"
            ? request.payload.modelId
            : typeof request.payload.model === "string"
              ? request.payload.model
              : null;
    const modelId = typeof modelValue === "string" ? modelValue.trim() : "";

    if (!provider || !modelId) {
        return null;
    }

    return {
        provider,
        modelId,
    };
}

function handleV2GetState(request) {
    return sendV2Success(request, taskdStatePayload());
}

async function handleV2GetAvailableModels(request) {
    try {
        const models = await fetchAvailableModelsFromPi();
        return sendV2Success(request, { models });
    } catch (error) {
        const code = typeof error?.code === "string" ? error.code : "INTERNAL_ERROR";
        const message = error instanceof Error ? error.message : String(error);
        const retryable = code === "TASK_NOT_READY";
        return sendV2Error(request, code, message, retryable, {});
    }
}

async function handleV2SetModel(request) {
    const parsed = parseSetModelRequest(request);
    if (!parsed) {
        return sendV2Error(request, "INVALID_REQUEST", "provider and modelId are required", false, {});
    }

    try {
        const selected = await setModelOnActiveTask(parsed.provider, parsed.modelId);
        return sendV2Success(request, selected);
    } catch (error) {
        const code = typeof error?.code === "string" ? error.code : "INTERNAL_ERROR";
        const message = error instanceof Error ? error.message : String(error);
        const retryable = code === "TASK_NOT_READY";
        return sendV2Error(request, code, message, retryable, {});
    }
}

async function handleV2ExtensionUiResponse(request) {
    try {
        const data = await forwardExtensionUiResponseToPi(request.payload);
        return sendV2Success(request, data);
    } catch (error) {
        const code = typeof error?.code === "string" ? error.code : "INTERNAL_ERROR";
        const message = error instanceof Error ? error.message : String(error);
        const retryable = code === "TASK_NOT_READY";
        return sendV2Error(request, code, message, retryable, {});
    }
}

async function handleV2SystemBash(request) {
    const parsed = parseSystemBashRequest(request);
    if (parsed.error) {
        return sendV2Error(request, "INVALID_REQUEST", parsed.error, false, {});
    }

    const result = await runSystemBash(parsed.command, parsed.cwd);
    return sendV2Success(request, {
        output: result.output,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        cwd: parsed.cwd,
    });
}

async function handleV2StopTask(request) {
    const taskId = typeof request.payload.taskId === "string" ? request.payload.taskId : null;

    if (!validateTaskId(taskId)) {
        return sendV2Error(request, "INVALID_REQUEST", "taskId is required", false, {});
    }

    const task = tasks.get(taskId);
    if (!task) {
        return sendV2Error(request, "TASK_NOT_FOUND", "task not found", false, {});
    }

    if (!["ready", "active", "idle", "errored", "stopped"].includes(task.state)) {
        return sendV2Error(request, "TASK_NOT_READY", "task cannot be stopped", true, {});
    }

    try {
        await stopTaskProcess(task);

        if (activeTaskId === taskId) {
            activeTaskId = null;
        }

        task.state = "stopped";
        emitEvent("task_stopped", taskId, {});

        return sendV2Success(request, {
            taskId,
            state: "stopped",
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return sendV2Error(request, "INTERNAL_ERROR", message, false, {});
    }
}

async function handleV2Request(request) {
    if (maybeHandleDuplicateIdempotentRequest(request)) {
        return;
    }

    switch (request.type) {
        case "create_or_open_task":
            await handleV2CreateOrOpenTask(request);
            return;
        case "switch_task":
            handleV2SwitchTask(request);
            return;
        case "prompt":
            await handleV2Prompt(request);
            return;
        case "runtime_get_state":
            handleV2GetState(request);
            return;
        case "runtime_diag":
            handleV2RuntimeDiag(request);
            return;
        case "pi_get_available_models":
            await handleV2GetAvailableModels(request);
            return;
        case "pi_set_model":
            await handleV2SetModel(request);
            return;
        case "extension_ui_response":
            await handleV2ExtensionUiResponse(request);
            return;
        case "system_bash":
            await handleV2SystemBash(request);
            return;
        case "stop_task":
            await handleV2StopTask(request);
            return;
        default:
            sendV2Error(request, "INVALID_REQUEST", `Unknown request type: ${request.type}`, false, {});
    }
}

async function handleRawHostLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
        return;
    }

    let raw;
    try {
        raw = JSON.parse(trimmed);
    } catch {
        log("[host] <- invalid JSON request");
        writeJson({
            ok: false,
            error: {
                code: "INVALID_REQUEST",
                message: "Invalid JSON",
                retryable: false,
                details: {},
            },
        });
        return;
    }

    const parsed = parseRequest(raw);
    if (!parsed.request) {
        const response = {
            id: parsed.id,
            ok: false,
            error: {
                code: "INVALID_REQUEST",
                message: parsed.error,
                retryable: false,
                details: {},
            },
        };
        writeJson(response);

        if (parsed.id) {
            traceHostCompleted(
                {
                    id: parsed.id,
                    type: "invalid",
                    payload: {},
                    receivedAtMs: Date.now(),
                },
                false,
                {
                    code: "INVALID_REQUEST",
                    message: parsed.error,
                },
            );
        }
        return;
    }

    parsed.request.receivedAtMs = Date.now();
    traceHostReceived(parsed.request);
    await handleV2Request(parsed.request);
}

async function bootstrapInitialTask() {
    if (!validateTaskId(INITIAL_TASK_ID)) {
        return;
    }

    try {
        await createOrOpenTaskInternal(INITIAL_TASK_ID, defaults);
        switchTaskInternal(INITIAL_TASK_ID, false);
        log(`Bootstrapped initial task ${INITIAL_TASK_ID}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Failed to bootstrap initial task ${INITIAL_TASK_ID}: ${message}`);
    }
}

function startServer() {
    const server = net.createServer((socket) => {
        if (hostSocket && hostSocket !== socket) {
            hostSocket.destroy();
        }

        hostSocket = socket;
        log("Host connected");

        const reader = readline.createInterface({
            input: socket,
            crlfDelay: Infinity,
        });

        reader.on("line", (line) => {
            void handleRawHostLine(line);
        });

        socket.on("close", () => {
            if (hostSocket === socket) {
                hostSocket = null;
            }
            log("Host disconnected");
        });

        socket.on("error", (error) => {
            log(`Host socket error: ${String(error)}`);
        });
    });

    server.on("error", (error) => {
        log(`Server error: ${String(error)}`);
    });

    server.listen(RPC_PORT, "0.0.0.0", () => {
        log(`Listening on ${RPC_PORT}`);
    });
}

async function main() {
    fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
    fs.mkdirSync(TASKS_ROOT, { recursive: true });
    log(`Sessions root: ${SESSIONS_ROOT}`);
    log(`Tasks root: ${TASKS_ROOT}`);

    await bootstrapInitialTask();
    startServer();
}

void main();
