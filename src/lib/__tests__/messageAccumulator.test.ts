import { describe, it, expect, beforeEach } from "vitest";
import { MessageAccumulator } from "../rpc/messageAccumulator";

describe("MessageAccumulator", () => {
    let accumulator: MessageAccumulator;

    beforeEach(() => {
        accumulator = new MessageAccumulator();
    });

    describe("conversation flow", () => {
        it("handles a simple question and answer", () => {
            // User asks a question
            accumulator.addUserMessage("What is 2+2?");

            // Agent starts responding
            accumulator.processEvent({ type: "agent_start" });
            accumulator.processEvent({ type: "turn_start" });

            // Agent streams response
            accumulator.processEvent({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "The answer is " },
            });
            accumulator.processEvent({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "4." },
            });
            accumulator.processEvent({
                type: "message_update",
                assistantMessageEvent: { type: "done", reason: "stop" },
            });
            accumulator.processEvent({ type: "agent_end", messages: [] });

            const state = accumulator.getState();

            // Should have 2 messages: user + assistant
            expect(state.messages).toHaveLength(2);
            expect(state.messages[0].role).toBe("user");
            expect(state.messages[1].role).toBe("assistant");

            // User message should be intact
            expect(state.messages[0].blocks[0]).toMatchObject({
                type: "text",
                text: "What is 2+2?",
            });

            // Assistant message should have accumulated text
            expect(state.messages[1].blocks[0]).toMatchObject({
                type: "text",
                text: "The answer is 4.",
            });

            // Agent should not be running anymore
            expect(state.isAgentRunning).toBe(false);
        });

        it("shows streaming state while agent is working", () => {
            accumulator.addUserMessage("Do something");
            accumulator.processEvent({ type: "agent_start" });

            expect(accumulator.getState().isAgentRunning).toBe(true);

            accumulator.processEvent({ type: "turn_start" });
            accumulator.processEvent({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Working..." },
            });

            const state = accumulator.getState();
            expect(state.messages[1].isStreaming).toBe(true);
            expect(state.messages[1].blocks[0]).toMatchObject({
                type: "text",
                text: "Working...",
                isStreaming: true,
            });
        });

        it("handles tool execution with visible progress", () => {
            accumulator.addUserMessage("List files");
            accumulator.processEvent({ type: "agent_start" });
            accumulator.processEvent({ type: "turn_start" });

            // Agent calls a tool
            accumulator.processEvent({
                type: "message_update",
                assistantMessageEvent: {
                    type: "toolcall_end",
                    contentIndex: 0,
                    toolCall: { id: "t1", name: "Bash", input: { command: "ls" } },
                },
            });

            // Tool starts executing
            accumulator.processEvent({
                type: "tool_execution_start",
                toolCallId: "t1",
                toolName: "Bash",
            });

            // Tool streams output
            accumulator.processEvent({
                type: "tool_execution_update",
                toolCallId: "t1",
                output: "file1.txt\nfile2.txt\n",
            });

            let state = accumulator.getState();
            const toolCall = state.messages[1].blocks.find((b) => b.type === "tool_call");
            expect(toolCall).toMatchObject({
                type: "tool_call",
                name: "Bash",
            });

            // Tool completes
            accumulator.processEvent({
                type: "tool_execution_end",
                toolCallId: "t1",
                result: { toolCallId: "t1", output: "file1.txt\nfile2.txt\n" },
            });

            state = accumulator.getState();
            const toolResult = state.messages[1].blocks.find((b) => b.type === "tool_result");
            expect(toolResult).toMatchObject({
                type: "tool_result",
                output: "file1.txt\nfile2.txt\n",
                isStreaming: false,
            });
        });

        it("captures errors from failed commands", () => {
            accumulator.processEvent({
                type: "response",
                command: "prompt",
                success: false,
                error: "Rate limit exceeded",
            });

            expect(accumulator.getState().error).toBe("Rate limit exceeded");
        });

        it("resets state for new conversation", () => {
            accumulator.addUserMessage("Hello");
            accumulator.processEvent({ type: "agent_start" });

            expect(accumulator.getState().messages).toHaveLength(1);

            accumulator.reset();

            expect(accumulator.getState().messages).toHaveLength(0);
            expect(accumulator.getState().isAgentRunning).toBe(false);
        });
    });
});
