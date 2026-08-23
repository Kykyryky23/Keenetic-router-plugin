import {describe, expect, it, vi} from "vitest";
import {getWanStatus, exportConfig, checkFirmwareUpdate} from "../../src/capabilities/diagnostics.js";
import {RouterTransport} from "../../src/transport/types.js";

describe("getWanStatus", () => {
    it("оставляет только интерфейсы с global: true, отфильтровывая LAN/мосты", async () => {
        const transport: RouterTransport = {
            show: vi.fn().mockResolvedValue({
                GigabitEthernet1: {id: "GigabitEthernet1", global: true, defaultgw: true},
                UsbLte0: {id: "UsbLte0", global: true, defaultgw: false},
                Bridge0: {id: "Bridge0", global: false},
            }),
            exec: vi.fn(),
        };

        const result = await getWanStatus(transport);

        expect(result).toEqual({
            GigabitEthernet1: {id: "GigabitEthernet1", global: true, defaultgw: true},
            UsbLte0: {id: "UsbLte0", global: true, defaultgw: false},
        });
    });

    it("не падает, если ни один интерфейс не помечен global: true", async () => {
        const transport: RouterTransport = {
            show: vi.fn().mockResolvedValue({Bridge0: {id: "Bridge0", global: false}}),
            exec: vi.fn(),
        };

        const result = await getWanStatus(transport);

        expect(result).toEqual({});
    });
});

describe("exportConfig", () => {
    it("склеивает message[] в единый текст построчно", async () => {
        const transport: RouterTransport = {
            show: vi.fn().mockResolvedValue({message: ["system", "    hostname test", "!"]}),
            exec: vi.fn(),
        };

        const result = await exportConfig(transport);

        expect(result).toBe("system\n    hostname test\n!");
    });
});

describe("checkFirmwareUpdate", () => {
    it("вызывает exec с {components: {list: {}}} и возвращает результат как есть", async () => {
        const transport: RouterTransport = {
            show: vi.fn(),
            exec: vi.fn().mockResolvedValue({current: {title: "5.0.12"}, new: {title: "5.1.3"}}),
        };

        const result = await checkFirmwareUpdate(transport);

        expect(transport.exec).toHaveBeenCalledWith({components: {list: {}}});
        expect(result).toEqual({current: {title: "5.0.12"}, new: {title: "5.1.3"}});
    });
});
