import {describe, expect, it} from "vitest";
import {buildAddPortForwardPayload, buildAddRoutePayload, buildRemovePortForwardPayload} from "../../src/capabilities/network.js";

describe("buildAddRoutePayload", () => {
    it("без metric не добавляет поле в payload", () => {
        const payload = buildAddRoutePayload({network: "10.0.5.0", mask: "255.255.255.0", target: "Wireguard1"});

        expect(payload).toEqual({
            ip: {route: [{network: "10.0.5.0", mask: "255.255.255.0", interface: "Wireguard1"}]},
        });
    });

    it("с metric добавляет поле metric в элемент массива (НЕ подтверждено вживую)", () => {
        const payload = buildAddRoutePayload({network: "10.0.5.0", mask: "255.255.255.0", target: "Wireguard1", metric: 2000});

        expect(payload).toEqual({
            ip: {route: [{network: "10.0.5.0", mask: "255.255.255.0", interface: "Wireguard1", metric: 2000}]},
        });
    });
});

describe("buildAddPortForwardPayload", () => {
    it("собирает подтверждённую на реальном роутере форму (массив, to-address/to-port)", () => {
        const payload = buildAddPortForwardPayload({
            proto: "tcp",
            externalPort: 8080,
            internalIp: "192.168.1.50",
            internalPort: 80,
            wanInterface: "GigabitEthernet1",
        });

        expect(payload).toEqual({
            ip: {
                static: [
                    {
                        protocol: "tcp",
                        interface: "GigabitEthernet1",
                        port: 8080,
                        "to-address": "192.168.1.50",
                        "to-port": 80,
                    },
                ],
            },
        });
    });
});

describe("buildRemovePortForwardPayload", () => {
    it("собирает форму по аналогии с подтверждённым удалением маршрута (no:true внутри элемента)", () => {
        const payload = buildRemovePortForwardPayload({proto: "udp", externalPort: 51820});

        expect(payload).toEqual({
            ip: {
                static: [{protocol: "udp", port: 51820, no: true}],
            },
        });
    });
});
