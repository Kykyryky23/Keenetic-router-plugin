import {describe, expect, it} from "vitest";
import {buildSetWifiPasswordPayload, buildSetWifiEnabledPayload} from "../../src/capabilities/wifi.js";

describe("buildSetWifiPasswordPayload", () => {
    it("вкладывает psk в объект {psk: ...} — подтверждённая на реальном роутере форма", () => {
        const payload = buildSetWifiPasswordPayload({interfaceId: "WifiMaster0/AccessPoint0", psk: "correct-horse"});

        expect(payload).toEqual({
            interface: {
                "WifiMaster0/AccessPoint0": {
                    authentication: {"wpa-psk": {psk: "correct-horse"}},
                },
            },
        });
    });

    it("отклоняет слишком короткий пароль (defense-in-depth, дублирует ограничение zod-схемы в register.ts)", () => {
        expect(() => buildSetWifiPasswordPayload({interfaceId: "WifiMaster0/AccessPoint0", psk: "short"})).toThrow(
            /8 до 63/,
        );
    });

    it("отклоняет слишком длинный пароль", () => {
        const tooLong = "a".repeat(64);
        expect(() => buildSetWifiPasswordPayload({interfaceId: "WifiMaster0/AccessPoint0", psk: tooLong})).toThrow(
            /8 до 63/,
        );
    });
});

describe("buildSetWifiEnabledPayload", () => {
    it("enabled: true -> {up: {}}", () => {
        const payload = buildSetWifiEnabledPayload({interfaceId: "WifiMaster0/AccessPoint1", enabled: true});
        expect(payload).toEqual({interface: {"WifiMaster0/AccessPoint1": {up: {}}}});
    });

    it("enabled: false -> {down: {}}", () => {
        const payload = buildSetWifiEnabledPayload({interfaceId: "WifiMaster0/AccessPoint1", enabled: false});
        expect(payload).toEqual({interface: {"WifiMaster0/AccessPoint1": {down: {}}}});
    });
});
