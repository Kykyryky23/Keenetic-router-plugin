import {describe, expect, it, vi} from "vitest";
import {
    buildBindRouteToVpnPayload,
    buildUnbindRouteFromVpnPayload,
    listVpnInterfaces
} from "../../src/capabilities/vpn.js";
import {RouterTransport} from "../../src/transport/types.js";

describe("buildBindRouteToVpnPayload / buildUnbindRouteFromVpnPayload", () => {
    it("bind делегирует в ту же форму, что и обычный add_route", () => {
        const payload = buildBindRouteToVpnPayload({network: "10.0.5.0", mask: "255.255.255.0", target: "Wireguard2"});
        expect(payload).toEqual({
            ip: {route: [{network: "10.0.5.0", mask: "255.255.255.0", interface: "Wireguard2"}]},
        });
    });

    it("unbind делегирует в ту же форму, что и обычный remove_route", () => {
        const payload = buildUnbindRouteFromVpnPayload({network: "10.0.5.0", mask: "255.255.255.0"});
        expect(payload).toEqual({
            ip: {route: [{network: "10.0.5.0", mask: "255.255.255.0", no: true}]},
        });
    });
});

describe("listVpnInterfaces", () => {
    it("оставляет только интерфейсы с VPN-типом (WireGuard подтверждён вживую)", async () => {
        const transport: RouterTransport = {
            show: vi.fn().mockResolvedValue({
                Wireguard2: {id: "Wireguard2", type: "Wireguard"},
                Bridge0: {id: "Bridge0", type: "Bridge"},
                GigabitEthernet1: {id: "GigabitEthernet1", type: "GigabitEthernet"},
            }),
            exec: vi.fn(),
        };

        const result = await listVpnInterfaces(transport);

        expect(result).toEqual({Wireguard2: {id: "Wireguard2", type: "Wireguard"}});
    });

    it("не падает и возвращает пусто, если VPN-интерфейсов нет вовсе", async () => {
        const transport: RouterTransport = {
            show: vi.fn().mockResolvedValue({Bridge0: {id: "Bridge0", type: "Bridge"}}),
            exec: vi.fn(),
        };

        const result = await listVpnInterfaces(transport);

        expect(result).toEqual({});
    });
});
