import { MockRpcClient, parseJsonl } from "$lib/rpc";

const sampleJsonl = `{"type":"message_update","content":"Hello"}\n{"type":"agent_end","reason":"done"}`;

describe("MockRpcClient", () => {
    it("parses JSONL fixtures", () => {
        const events = parseJsonl(sampleJsonl);
        expect(events).toHaveLength(2);
        expect(events[0].type).toBe("message_update");
    });

    it("streams events to subscribers", async () => {
        const events = parseJsonl(sampleJsonl);
        const client = new MockRpcClient(events, { delayMs: 0 });
        const received: string[] = [];

        client.subscribe((event) => {
            received.push(event.type);
        });

        await client.connect();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(received).toEqual(["message_update", "agent_end"]);
    });

    it("records sent commands", async () => {
        const client = new MockRpcClient([]);
        await client.send({ type: "prompt", content: "hello" });

        expect(client.sentCommands).toEqual([{ type: "prompt", content: "hello" }]);
    });
});
