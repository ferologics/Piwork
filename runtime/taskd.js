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
const INITIAL_TASK_ID = process.env.PIWORK_INITIAL_TASK_ID || "";
const DEFAULT_PROVIDER = process.env.PIWORK_DEFAULT_PROVIDER || "anthropic";
const DEFAULT_MODEL = process.env.PIWORK_DEFAULT_MODEL || "claude-opus-4-5";
const DEFAULT_THINKING_LEVEL = process.env.PIWORK_DEFAULT_THINKING || "high";
const LEGACY_TASK_ID = "__legacy__";
const CHILD_COMMAND_TIMEOUT_MS = 10_000;
const STOP_GRACE_PERIOD_MS = 1_200;

const FALLBACK_MODELS = [
    {
        id: "claude-opus-4-5",
        name: "Opus 4.5",
        provider: "anthropic",
    },
    {
        id: "gpt-5.2-codex",
        name: "GPT 5.2",
        provider: "openai-codex",
    },
    {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro",
        provider: "google-gemini-cli",
    },
];

const IDEMPOTENT_REQUESTS = new Set(["create_or_open_task", "switch_task", "stop_task"]);

const tasks = new Map();
const requestCache = new Map();

let activeTaskId = null;
let hostSocket = null;

let defaults = {
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    thinkingLevel: DEFAULT_THINKING_LEVEL,
};

function log(message) {
    console.log(`[taskd] ${message}`);
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

function normalizePayload(raw) {
    if (!isRecord(raw)) {
        return {};
    }

    if (isRecord(raw.payload)) {
        return { ...raw.payload };
    }

    const payload = {};

    if (typeof raw.taskId === "string") {
        payload.taskId = raw.taskId;
    }
    if (typeof raw.message === "string") {
        payload.message = raw.message;
    }
    if (typeof raw.promptId === "string") {
        payload.promptId = raw.promptId;
    }
    if (typeof raw.provider === "string") {
        payload.provider = raw.provider;
    }
    if (typeof raw.model === "string") {
        payload.model = raw.model;
    }
    if (typeof raw.modelId === "string") {
        payload.model = raw.modelId;
    }
    if (typeof raw.thinkingLevel === "string") {
        payload.thinkingLevel = raw.thinkingLevel;
    }
    if (typeof raw.workingFolder === "string") {
        payload.workingFolder = raw.workingFolder;
    }

    return payload;
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
        timestamp: new Date().toISOString(),
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
        return true;
    }

    writeJson(cached.response);
    return true;
}

function sendV2Success(request, result) {
    const response = {
        id: request.id || null,
        ok: true,
        result,
    };

    cacheIdempotentResponse(request, response);
    writeJson(response);
    return response;
}

function sendV2Error(request, code, message, retryable = false, details = {}) {
    const response = {
        id: request.id || null,
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
    return response;
}

function sendLegacyResponse(command, success, data, error, id) {
    const response = {
        type: "response",
        command,
        success,
    };

    if (typeof id === "string") {
        response.id = id;
    }

    if (success) {
        response.data = data ?? {};
    } else {
        response.error = error || "Unknown error";
    }

    writeJson(response);
}

function buildTask(taskId, options = {}) {
    const sessionDir = path.join(SESSIONS_ROOT, taskId);
    const sessionFile = path.join(sessionDir, "session.json");
    const workDir = path.join(sessionDir, "work");

    return {
        taskId,
        state: "missing",
        provider: typeof options.provider === "string" ? options.provider : defaults.provider,
        model: typeof options.model === "string" ? options.model : defaults.model,
        thinkingLevel:
            typeof options.thinkingLevel === "string" ? options.thinkingLevel : defaults.thinkingLevel,
        requestedWorkingFolder:
            typeof options.workingFolder === "string" ? options.workingFolder : null,
        sessionFile,
        workDir,
        child: null,
        pendingChildRequests: new Map(),
        stopping: false,
        promptInFlight: false,
        promptCommandId: null,
    };
}

function serializeTask(task) {
    return {
        taskId: task.taskId,
        state: task.state,
        sessionFile: task.sessionFile,
        workDir: task.workDir,
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
    if (typeof options.workingFolder === "string") {
        task.requestedWorkingFolder = options.workingFolder;
    }
}

function rejectPendingChildRequests(task, reason) {
    for (const [id, pending] of task.pendingChildRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(reason));
        task.pendingChildRequests.delete(id);
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

    let payload;
    try {
        payload = JSON.parse(trimmed);
    } catch {
        log(`task ${task.taskId} emitted non-JSON line: ${trimmed}`);
        return;
    }

    if (payload.type === "response" && typeof payload.id === "string") {
        const pending = task.pendingChildRequests.get(payload.id);
        if (pending) {
            clearTimeout(pending.timeout);
            task.pendingChildRequests.delete(payload.id);
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

    fs.mkdirSync(task.workDir, { recursive: true });

    const args = [PI_CLI, "--mode", "rpc", "--session", task.sessionFile];

    const child = spawn(NODE_BIN, args, {
        cwd: task.workDir,
        env: {
            ...process.env,
            PI_WORKING_DIR: task.workDir,
        },
        stdio: ["pipe", "pipe", "pipe"],
    });

    task.child = child;
    task.stopping = false;
    task.promptInFlight = false;
    task.promptCommandId = null;

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

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            task.pendingChildRequests.delete(id);
            reject(new Error(`Task command timed out: ${payload.type}`));
        }, timeoutMs);

        task.pendingChildRequests.set(id, { resolve, reject, timeout });

        task.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
            if (!error) {
                return;
            }

            clearTimeout(timeout);
            task.pendingChildRequests.delete(id);
            reject(error);
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

async function runShellCommand(command) {
    return await new Promise((resolve) => {
        const child = spawn("/bin/sh", ["-lc", command], {
            stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";

        child.stdout.on("data", (chunk) => {
            output += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            output += chunk.toString();
        });

        child.on("error", (error) => {
            resolve({
                output: `${output}${String(error)}`,
                exitCode: 1,
            });
        });

        child.on("close", (code) => {
            resolve({
                output,
                exitCode: typeof code === "number" ? code : 1,
            });
        });
    });
}

function parseRequest(raw) {
    if (!isRecord(raw) || typeof raw.type !== "string") {
        return null;
    }

    const hasPayloadField = Object.prototype.hasOwnProperty.call(raw, "payload");

    return {
        id: typeof raw.id === "string" ? raw.id : null,
        type: raw.type,
        payload: normalizePayload(raw),
        raw,
        hasPayloadField,
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
        return sendV2Error(request, code, message, pickTaskNotReadyRetryable(code), {});
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

function handleV2GetState(request) {
    const payload = {
        activeTaskId,
        tasks: Array.from(tasks.values()).map(serializeTask),
    };

    return sendV2Success(request, payload);
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
    if (!request.id) {
        return sendV2Error(request, "INVALID_REQUEST", "id is required", false, {});
    }

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
        case "get_state":
            handleV2GetState(request);
            return;
        case "stop_task":
            await handleV2StopTask(request);
            return;
        default:
            sendV2Error(request, "INVALID_REQUEST", `Unknown request type: ${request.type}`, false, {});
    }
}

function legacyStatePayload() {
    const activeTask = activeTaskId ? tasks.get(activeTaskId) : null;

    return {
        model: {
            id: activeTask?.model || defaults.model,
            name: activeTask?.model || defaults.model,
            provider: activeTask?.provider || defaults.provider,
        },
        sessionName: activeTaskId,
        sessionId: activeTaskId,
        isStreaming: Boolean(activeTask?.promptInFlight),
        activeTaskId,
        tasks: Array.from(tasks.values()).map(serializeTask),
    };
}

async function handleLegacyGetState(request) {
    sendLegacyResponse("get_state", true, legacyStatePayload(), null, request.id || undefined);
}

async function handleLegacyGetAvailableModels(request) {
    sendLegacyResponse(
        "get_available_models",
        true,
        {
            models: FALLBACK_MODELS,
        },
        null,
        request.id || undefined,
    );
}

async function handleLegacySetModel(request) {
    const provider = typeof request.payload.provider === "string" ? request.payload.provider : defaults.provider;
    const model =
        typeof request.payload.model === "string"
            ? request.payload.model
            : typeof request.raw.modelId === "string"
              ? request.raw.modelId
              : defaults.model;

    defaults = {
        ...defaults,
        provider,
        model,
    };

    if (activeTaskId) {
        const activeTask = tasks.get(activeTaskId);
        if (activeTask) {
            activeTask.provider = provider;
            activeTask.model = model;
            if (activeTask.child) {
                void sendToTask(activeTask, {
                    type: "set_model",
                    provider,
                    modelId: model,
                }).catch((error) => {
                    log(`legacy set_model passthrough failed: ${String(error)}`);
                });
            }
        }
    }

    sendLegacyResponse(
        "set_model",
        true,
        {
            id: model,
            name: model,
            provider,
        },
        null,
        request.id || undefined,
    );
}

async function handleLegacyPrompt(request) {
    const message = typeof request.payload.message === "string" ? request.payload.message : null;

    if (!message) {
        sendLegacyResponse("prompt", false, null, "message is required", request.id || undefined);
        return;
    }

    try {
        const task = await startPromptOnActiveTask(message);
        sendLegacyResponse(
            "prompt",
            true,
            {
                accepted: true,
                taskId: task.taskId,
            },
            null,
            request.id || undefined,
        );
    } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        sendLegacyResponse("prompt", false, null, messageText, request.id || undefined);
    }
}

async function handleLegacyExtensionUiResponse(request) {
    if (!activeTaskId) {
        sendLegacyResponse(
            "extension_ui_response",
            false,
            null,
            "No active task",
            request.id || undefined,
        );
        return;
    }

    const task = tasks.get(activeTaskId);
    if (!task || !task.child || task.child.stdin.destroyed) {
        sendLegacyResponse(
            "extension_ui_response",
            false,
            null,
            "No active task process",
            request.id || undefined,
        );
        return;
    }

    task.child.stdin.write(`${JSON.stringify(request.raw)}\n`);
    sendLegacyResponse("extension_ui_response", true, {}, null, request.id || undefined);
}

async function handleLegacyBash(request) {
    const command = typeof request.raw.command === "string" ? request.raw.command : "";
    if (!command.trim()) {
        sendLegacyResponse("bash", false, null, "command is required", request.id || undefined);
        return;
    }

    const result = await runShellCommand(command);
    sendLegacyResponse(
        "bash",
        true,
        {
            output: result.output,
            exitCode: result.exitCode,
        },
        null,
        request.id || undefined,
    );
}

async function handleLegacySwitchSession(request) {
    sendLegacyResponse(
        "switch_session",
        false,
        null,
        "switch_session is unsupported in taskd mode",
        request.id || undefined,
    );
}

async function handleLegacyRequest(request) {
    switch (request.type) {
        case "get_state":
            await handleLegacyGetState(request);
            return;
        case "get_available_models":
            await handleLegacyGetAvailableModels(request);
            return;
        case "set_model":
            await handleLegacySetModel(request);
            return;
        case "prompt":
            await handleLegacyPrompt(request);
            return;
        case "extension_ui_response":
            await handleLegacyExtensionUiResponse(request);
            return;
        case "bash":
            await handleLegacyBash(request);
            return;
        case "switch_session":
            await handleLegacySwitchSession(request);
            return;
        default:
            sendLegacyResponse(request.type, false, null, `Unknown command: ${request.type}`, request.id || undefined);
    }
}

function isV2Request(request) {
    if (request.hasPayloadField) {
        return true;
    }

    return ["create_or_open_task", "switch_task", "stop_task"].includes(request.type);
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

    const request = parseRequest(raw);
    if (!request) {
        writeJson({
            ok: false,
            error: {
                code: "INVALID_REQUEST",
                message: "Request must include string type",
                retryable: false,
                details: {},
            },
        });
        return;
    }

    if (isV2Request(request)) {
        await handleV2Request(request);
        return;
    }

    await handleLegacyRequest(request);
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
    log(`Sessions root: ${SESSIONS_ROOT}`);

    await bootstrapInitialTask();
    startServer();
}

void main();
