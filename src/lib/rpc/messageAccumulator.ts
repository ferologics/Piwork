/**
 * Accumulates RPC streaming events into renderable conversation state
 */

import type {
    RpcPayload,
    MessageUpdateEvent,
    ToolExecutionStartEvent,
    ToolExecutionUpdateEvent,
    ToolExecutionEndEvent,
    AgentMessage,
    ToolResult,
} from "./types";

export interface TextBlock {
    type: "text";
    text: string;
    isStreaming: boolean;
}

export interface ThinkingBlock {
    type: "thinking";
    text: string;
    isStreaming: boolean;
    isCollapsed: boolean;
}

export interface ToolCallBlock {
    type: "tool_call";
    id: string;
    name: string;
    input: string;
    isStreaming: boolean;
    isCollapsed: boolean;
}

export interface ToolResultBlock {
    type: "tool_result";
    toolCallId: string;
    output: string;
    isError: boolean;
    isStreaming: boolean;
    isCollapsed: boolean;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock | ToolResultBlock;

export interface ConversationMessage {
    role: "user" | "assistant";
    blocks: ContentBlock[];
    isStreaming: boolean;
}

export interface ConversationState {
    messages: ConversationMessage[];
    isAgentRunning: boolean;
    error: string | null;
}

export class MessageAccumulator {
    private state: ConversationState = {
        messages: [],
        isAgentRunning: false,
        error: null,
    };

    private currentText = "";
    private currentThinking = "";
    private currentToolInput = "";
    private currentToolId = "";
    private currentToolName = "";
    private activeToolOutputs = new Map<string, string>();

    getState(): ConversationState {
        return { ...this.state, messages: [...this.state.messages] };
    }

    addUserMessage(text: string): void {
        this.state.messages.push({
            role: "user",
            blocks: [{ type: "text", text, isStreaming: false }],
            isStreaming: false,
        });
    }

    processEvent(payload: RpcPayload): void {
        // Debug: log what we receive
        if (import.meta.env.DEV) {
            console.log("[Accumulator]", payload.type, payload);
        }

        switch (payload.type) {
            case "agent_start":
                this.state.isAgentRunning = true;
                this.state.error = null;
                break;

            case "agent_end":
                this.state.isAgentRunning = false;
                this.finalizeCurrentMessage();
                break;

            case "turn_start":
                // Start a new assistant message
                this.ensureAssistantMessage();
                break;

            case "turn_end":
                this.finalizeCurrentMessage();
                break;

            case "message_update":
                this.handleMessageUpdate(payload as MessageUpdateEvent);
                break;

            case "tool_execution_start":
                this.handleToolExecutionStart(payload as ToolExecutionStartEvent);
                break;

            case "tool_execution_update":
                this.handleToolExecutionUpdate(payload as ToolExecutionUpdateEvent);
                break;

            case "tool_execution_end":
                this.handleToolExecutionEnd(payload as ToolExecutionEndEvent);
                break;

            case "message_end":
                // Extract content from the completed message
                this.handleMessageEnd(payload as { message?: Record<string, unknown> });
                break;

            case "response":
                // Handle command responses (errors, etc.)
                if (payload.success === false && payload.error) {
                    this.state.error = payload.error as string;
                }
                break;
        }
    }

    private handleMessageEnd(payload: { message?: Record<string, unknown> }): void {
        const message = payload.message;
        if (!message) return;

        // Ignore user message echoes - we already added the user message locally
        if (message.role === "user") return;

        const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : null;

        // Check if we already have text blocks from streaming
        const lastMsg = this.state.messages[this.state.messages.length - 1];
        const hasTextBlocks =
            lastMsg?.role === "assistant" &&
            lastMsg.blocks.some((b: ContentBlock) => b.type === "text");

        if (!hasTextBlocks) {
            const content = this.extractMessageContent(message);
            if (content) {
                const msg = this.ensureAssistantMessage();
                this.updateOrAddBlock(msg, "text", {
                    type: "text",
                    text: content,
                    isStreaming: false,
                });
            } else if (errorMessage) {
                // Show error if no content but there's an error
                this.state.error = errorMessage;
            }
        } else if (errorMessage) {
            this.state.error = errorMessage;
        }

        this.finalizeCurrentMessage();
    }

    private extractMessageContent(message: Record<string, unknown>): string | null {
        // String content
        if (typeof message.content === "string") {
            return message.content;
        }

        // Array of content blocks
        if (Array.isArray(message.content)) {
            const parts = message.content
                .filter((part): part is Record<string, unknown> =>
                    typeof part === "object" && part !== null
                )
                .filter((part) => part.type === "text" && typeof part.text === "string")
                .map((part) => part.text as string);

            if (parts.length > 0) {
                return parts.join("");
            }
        }

        return null;
    }

    private ensureAssistantMessage(): ConversationMessage {
        const last = this.state.messages[this.state.messages.length - 1];
        if (last?.role === "assistant" && last.isStreaming) {
            return last;
        }

        const msg: ConversationMessage = {
            role: "assistant",
            blocks: [],
            isStreaming: true,
        };
        this.state.messages.push(msg);
        return msg;
    }

    private handleMessageUpdate(event: MessageUpdateEvent): void {
        const { assistantMessageEvent } = event;
        if (!assistantMessageEvent) return;

        const msg = this.ensureAssistantMessage();

        switch (assistantMessageEvent.type) {
            case "text_start":
                this.currentText = "";
                break;

            case "text_delta":
                this.currentText += assistantMessageEvent.delta;
                this.updateOrAddBlock(msg, "text", {
                    type: "text",
                    text: this.currentText,
                    isStreaming: true,
                });
                break;

            case "text_end":
                this.updateOrAddBlock(msg, "text", {
                    type: "text",
                    text: assistantMessageEvent.content || this.currentText,
                    isStreaming: false,
                });
                this.currentText = "";
                break;

            case "thinking_start":
                this.currentThinking = "";
                break;

            case "thinking_delta":
                this.currentThinking += assistantMessageEvent.delta;
                this.updateOrAddBlock(msg, "thinking", {
                    type: "thinking",
                    text: this.currentThinking,
                    isStreaming: true,
                    isCollapsed: false,
                });
                break;

            case "thinking_end":
                this.updateOrAddBlock(msg, "thinking", {
                    type: "thinking",
                    text: assistantMessageEvent.content || this.currentThinking,
                    isStreaming: false,
                    isCollapsed: true, // Collapse when done
                });
                this.currentThinking = "";
                break;

            case "toolcall_start":
                this.currentToolId = assistantMessageEvent.toolCallId;
                this.currentToolName = assistantMessageEvent.toolName;
                this.currentToolInput = "";
                break;

            case "toolcall_delta":
                this.currentToolInput += assistantMessageEvent.delta;
                this.updateOrAddToolCall(msg, this.currentToolId, {
                    type: "tool_call",
                    id: this.currentToolId,
                    name: this.currentToolName,
                    input: this.currentToolInput,
                    isStreaming: true,
                    isCollapsed: false,
                });
                break;

            case "toolcall_end":
                const toolCall = assistantMessageEvent.toolCall;
                this.updateOrAddToolCall(msg, toolCall.id, {
                    type: "tool_call",
                    id: toolCall.id,
                    name: toolCall.name,
                    input: JSON.stringify(toolCall.input, null, 2),
                    isStreaming: false,
                    isCollapsed: true,
                });
                this.currentToolId = "";
                this.currentToolName = "";
                this.currentToolInput = "";
                break;

            case "done":
                msg.isStreaming = false;
                break;

            case "error":
                msg.isStreaming = false;
                this.state.error = assistantMessageEvent.error || "Unknown error";
                break;
        }
    }

    private handleToolExecutionStart(event: ToolExecutionStartEvent): void {
        this.activeToolOutputs.set(event.toolCallId, "");
    }

    private handleToolExecutionUpdate(event: ToolExecutionUpdateEvent): void {
        const current = this.activeToolOutputs.get(event.toolCallId) || "";
        this.activeToolOutputs.set(event.toolCallId, current + event.output);

        // Update the tool result block if it exists
        const msg = this.state.messages[this.state.messages.length - 1];
        if (msg?.role === "assistant") {
            this.updateOrAddToolResult(msg, event.toolCallId, {
                type: "tool_result",
                toolCallId: event.toolCallId,
                output: this.activeToolOutputs.get(event.toolCallId) || "",
                isError: false,
                isStreaming: true,
                isCollapsed: false,
            });
        }
    }

    private handleToolExecutionEnd(event: ToolExecutionEndEvent): void {
        const msg = this.state.messages[this.state.messages.length - 1];
        if (msg?.role === "assistant") {
            this.updateOrAddToolResult(msg, event.toolCallId, {
                type: "tool_result",
                toolCallId: event.toolCallId,
                output: event.result.output,
                isError: event.result.isError || false,
                isStreaming: false,
                isCollapsed: true,
            });
        }
        this.activeToolOutputs.delete(event.toolCallId);
    }

    private updateOrAddBlock(
        msg: ConversationMessage,
        type: "text" | "thinking",
        block: TextBlock | ThinkingBlock,
    ): void {
        // Find the last block of this type that's streaming
        const idx = msg.blocks.findLastIndex((b) => b.type === type && (b as TextBlock).isStreaming);
        if (idx >= 0) {
            msg.blocks[idx] = block;
        } else {
            msg.blocks.push(block);
        }
    }

    private updateOrAddToolCall(msg: ConversationMessage, id: string, block: ToolCallBlock): void {
        const idx = msg.blocks.findIndex((b) => b.type === "tool_call" && (b as ToolCallBlock).id === id);
        if (idx >= 0) {
            msg.blocks[idx] = block;
        } else {
            msg.blocks.push(block);
        }
    }

    private updateOrAddToolResult(msg: ConversationMessage, toolCallId: string, block: ToolResultBlock): void {
        const idx = msg.blocks.findIndex(
            (b) => b.type === "tool_result" && (b as ToolResultBlock).toolCallId === toolCallId,
        );
        if (idx >= 0) {
            msg.blocks[idx] = block;
        } else {
            // Insert after the corresponding tool_call
            const toolCallIdx = msg.blocks.findIndex(
                (b) => b.type === "tool_call" && (b as ToolCallBlock).id === toolCallId,
            );
            if (toolCallIdx >= 0) {
                msg.blocks.splice(toolCallIdx + 1, 0, block);
            } else {
                msg.blocks.push(block);
            }
        }
    }

    private finalizeCurrentMessage(): void {
        const last = this.state.messages[this.state.messages.length - 1];
        if (last?.role === "assistant") {
            last.isStreaming = false;
            for (const block of last.blocks) {
                if ("isStreaming" in block) {
                    block.isStreaming = false;
                }
            }
        }
        this.currentText = "";
        this.currentThinking = "";
        this.currentToolInput = "";
        this.currentToolId = "";
        this.currentToolName = "";
    }

    reset(): void {
        this.state = {
            messages: [],
            isAgentRunning: false,
            error: null,
        };
        this.currentText = "";
        this.currentThinking = "";
        this.currentToolInput = "";
        this.currentToolId = "";
        this.currentToolName = "";
        this.activeToolOutputs.clear();
    }
}
