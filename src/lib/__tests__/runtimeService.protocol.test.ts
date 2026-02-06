import { RuntimeService } from "$lib/services/runtimeService";

describe("RuntimeService protocol response correlation", () => {
    it("ignores forwarded pi response events when resolving pending taskd commands", () => {
        const service = new RuntimeService();
        const runtimeService = service as unknown as {
            pendingRpcResponses: Map<
                string,
                {
                    resolve: (payload: Record<string, unknown>) => void;
                    reject: (error: Error) => void;
                    timeout: ReturnType<typeof setTimeout>;
                }
            >;
            resolvePendingRpcResponse: (payload: Record<string, unknown>) => void;
        };

        let resolvedPayload: Record<string, unknown> | null = null;
        const timeout = setTimeout(() => undefined, 10_000);

        runtimeService.pendingRpcResponses.set("req-legacy", {
            resolve: (payload) => {
                resolvedPayload = payload;
            },
            reject: () => undefined,
            timeout,
        });

        runtimeService.resolvePendingRpcResponse({
            id: "req-legacy",
            type: "response",
            command: "prompt",
            success: true,
            data: {},
        });

        expect(resolvedPayload).toBeNull();
        expect(runtimeService.pendingRpcResponses.has("req-legacy")).toBe(true);

        clearTimeout(timeout);
        runtimeService.pendingRpcResponses.clear();
    });

    it("resolves pending taskd commands only for v2 response envelopes", () => {
        const service = new RuntimeService();
        const runtimeService = service as unknown as {
            pendingRpcResponses: Map<
                string,
                {
                    resolve: (payload: Record<string, unknown>) => void;
                    reject: (error: Error) => void;
                    timeout: ReturnType<typeof setTimeout>;
                }
            >;
            resolvePendingRpcResponse: (payload: Record<string, unknown>) => void;
        };

        let resolvedPayload: Record<string, unknown> | null = null;
        const timeout = setTimeout(() => undefined, 10_000);

        runtimeService.pendingRpcResponses.set("req-v2", {
            resolve: (payload) => {
                resolvedPayload = payload;
            },
            reject: () => undefined,
            timeout,
        });

        runtimeService.resolvePendingRpcResponse({
            id: "req-v2",
            ok: true,
            result: {
                accepted: true,
            },
        });

        expect(resolvedPayload).toEqual({
            id: "req-v2",
            ok: true,
            result: {
                accepted: true,
            },
        });
        expect(runtimeService.pendingRpcResponses.has("req-v2")).toBe(false);
    });
});
