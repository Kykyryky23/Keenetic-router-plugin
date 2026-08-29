import {describe, expect, it} from "vitest";
import {buildAddDomainRoutePayload} from "../../src/capabilities/dns-routing.js";

describe("buildAddDomainRoutePayload", () => {
    it("собирает object-group fqdn + dns-proxy route в форме, подтверждённой вживую через перехват XHR веб-интерфейса", () => {
        const payload = buildAddDomainRoutePayload({
            name: "domain-list3",
            description: "GooglePlay",
            domains: ["play.google.com", "android.clients.google.com"],
            target: "Wireguard1",
        });

        expect(payload).toEqual({
            "object-group": {
                fqdn: {
                    "domain-list3": {
                        description: "GooglePlay",
                        include: [{address: "play.google.com"}, {address: "android.clients.google.com"}],
                    },
                },
            },
            "dns-proxy": {
                route: {group: "domain-list3", gateway: "", auto: true, reject: false, interface: "Wireguard1"},
            },
        });
    });
});
