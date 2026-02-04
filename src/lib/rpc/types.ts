/**
 * RPC types for pi agent
 * See: https://github.com/anthropics/anthropic-tools/blob/main/docs/rpc.md
 */

// Client interface
export type RpcEvent = Record<string, unknown> & {
    type: string;
};

export type RpcListener = (event: RpcEvent) => void;

export interface RpcClient {
    connect(workingFolder?: string | null): Promise<void>;
    disconnect(): Promise<void>;
    stopVm(): Promise<void>;
    send(command: Record<string, unknown>): Promise<void>;
    subscribe(listener: RpcListener): () => void;
}

// Assistant message delta types
export type AssistantMessageEventType =
    | "start"
    | "text_start"
    | "text_delta"
    | "text_end"
    | "thinking_start"
    | "thinking_delta"
    | "thinking_end"
    | "toolcall_start"
    | "toolcall_delta"
    | "toolcall_end"
    | "done"
    | "error";

export interface TextDeltaEvent {
    type: "text_delta";
    contentIndex: number;
    delta: string;
}

export interface TextStartEvent {
    type: "text_start";
    contentIndex: number;
}

export interface TextEndEvent {
    type: "text_end";
    contentIndex: number;
    content: string;
}

export interface ThinkingDeltaEvent {
    type: "thinking_delta";
    contentIndex: number;
    delta: string;
}

export interface ThinkingStartEvent {
    type: "thinking_start";
    contentIndex: number;
}

export interface ThinkingEndEvent {
    type: "thinking_end";
    contentIndex: number;
    content: string;
}

export interface ToolCallStartEvent {
    type: "toolcall_start";
    contentIndex: number;
    toolName: string;
    toolCallId: string;
}

export interface ToolCallDeltaEvent {
    type: "toolcall_delta";
    contentIndex: number;
    delta: string;
}

export interface ToolCallEndEvent {
    type: "toolcall_end";
    contentIndex: number;
    toolCall: ToolCall;
}

export interface DoneEvent {
    type: "done";
    reason: "stop" | "length" | "toolUse";
}

export interface ErrorEvent {
    type: "error";
    reason: "aborted" | "error";
    error?: string;
}

export type AssistantMessageEvent =
    | { type: "start" }
    | TextStartEvent
    | TextDeltaEvent
    | TextEndEvent
    | ThinkingStartEvent
    | ThinkingDeltaEvent
    | ThinkingEndEvent
    | ToolCallStartEvent
    | ToolCallDeltaEvent
    | ToolCallEndEvent
    | DoneEvent
    | ErrorEvent;

// Tool types
export interface ToolCall {
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export interface ToolResult {
    toolCallId: string;
    output: string;
    isError?: boolean;
}

// Message types
export interface AgentMessage {
    role: "user" | "assistant";
    content: MessageContent[];
    model?: string;
}

export type MessageContent =
    | { type: "text"; text: string }
    | { type: "thinking"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

// RPC Events
export interface AgentStartEvent {
    type: "agent_start";
}

export interface AgentEndEvent {
    type: "agent_end";
    messages: AgentMessage[];
}

export interface TurnStartEvent {
    type: "turn_start";
}

export interface TurnEndEvent {
    type: "turn_end";
    message: AgentMessage;
    toolResults?: ToolResult[];
}

export interface MessageStartEvent {
    type: "message_start";
    message: AgentMessage;
}

export interface MessageUpdateEvent {
    type: "message_update";
    message?: AgentMessage;
    assistantMessageEvent: AssistantMessageEvent;
}

export interface MessageEndEvent {
    type: "message_end";
    message: AgentMessage;
}

export interface ToolExecutionStartEvent {
    type: "tool_execution_start";
    toolCallId: string;
    toolName: string;
}

export interface ToolExecutionUpdateEvent {
    type: "tool_execution_update";
    toolCallId: string;
    output: string;
}

export interface ToolExecutionEndEvent {
    type: "tool_execution_end";
    toolCallId: string;
    result: ToolResult;
}

export interface ResponseEvent {
    type: "response";
    command: string;
    success: boolean;
    data?: unknown;
    error?: string;
    id?: string;
}

export interface ExtensionUiRequestEvent {
    type: "extension_ui_request";
    id: string;
    method: string;
    title?: string;
    message?: string;
    options?: string[];
    placeholder?: string;
    prefill?: string;
}

export type RpcPayload =
    | AgentStartEvent
    | AgentEndEvent
    | TurnStartEvent
    | TurnEndEvent
    | MessageStartEvent
    | MessageUpdateEvent
    | MessageEndEvent
    | ToolExecutionStartEvent
    | ToolExecutionUpdateEvent
    | ToolExecutionEndEvent
    | ResponseEvent
    | ExtensionUiRequestEvent
    | { type: string; [key: string]: unknown };
