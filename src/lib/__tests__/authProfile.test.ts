import { normalizeAuthProfile } from "$lib/services/authProfile";

describe("normalizeAuthProfile", () => {
    it("defaults missing/empty values", () => {
        expect(normalizeAuthProfile(undefined)).toBe("default");
        expect(normalizeAuthProfile(null)).toBe("default");
        expect(normalizeAuthProfile("")).toBe("default");
        expect(normalizeAuthProfile("   ")).toBe("default");
    });

    it("accepts safe profile names", () => {
        expect(normalizeAuthProfile("default")).toBe("default");
        expect(normalizeAuthProfile("work")).toBe("work");
        expect(normalizeAuthProfile("work-profile_1.2")).toBe("work-profile_1.2");
    });

    it("rejects path-like or unsafe profile names", () => {
        expect(normalizeAuthProfile("../secret")).toBe("default");
        expect(normalizeAuthProfile("..")).toBe("default");
        expect(normalizeAuthProfile("work/ops")).toBe("default");
        expect(normalizeAuthProfile("work\\ops")).toBe("default");
        expect(normalizeAuthProfile("with space")).toBe("default");
    });
});
