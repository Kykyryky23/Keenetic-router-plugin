import {describe, expect, it} from "vitest";
import {buildAddPortForwardPayload, buildRemovePortForwardPayload} from "../../src/capabilities/network.js";

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
