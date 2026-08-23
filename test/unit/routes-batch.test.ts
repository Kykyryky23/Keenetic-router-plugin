import {describe, expect, it, vi} from "vitest";
import {
    parseRouteBatch,
    RouteBatchParseError,
    buildRouteBatchPayload,
    applyRouteBatch
} from "../../src/capabilities/routes-batch.js";
import {RouterTransport} from "../../src/transport/types.js";

describe("parseRouteBatch", () => {
    it("парсит все четыре поддерживаемые команды и игнорирует комментарии/пустые строки", () => {
        const text = [
            ":: комментарий",
            "",
            "ROUTE ADD 10.0.5.0 MASK 255.255.255.0 ISP",
            "ROUTE DELETE 10.0.5.0 MASK 255.255.255.0",
            "VPN BIND 10.0.7.0 MASK 255.255.255.0 -> Wireguard0",
            "VPN UNBIND 10.0.7.0 MASK 255.255.255.0",
        ].join("\n");

        const commands = parseRouteBatch(text);

        expect(commands).toHaveLength(4);
        expect(commands[0]).toMatchObject({
            kind: "route-add",
            network: "10.0.5.0",
            mask: "255.255.255.0",
            iface: "ISP"
        });
        expect(commands[1]).toMatchObject({kind: "route-delete", network: "10.0.5.0", mask: "255.255.255.0"});
        expect(commands[2]).toMatchObject({
            kind: "vpn-bind",
            network: "10.0.7.0",
            mask: "255.255.255.0",
            iface: "Wireguard0"
        });
        expect(commands[3]).toMatchObject({kind: "vpn-unbind", network: "10.0.7.0", mask: "255.255.255.0"});
    });

    it("fail-closed: отклоняет весь батч при первой нераспознанной строке", () => {
        const text = ["ROUTE ADD 10.0.5.0 MASK 255.255.255.0 ISP", "DEL /S /Q C:\\important"].join("\n");

        expect(() => parseRouteBatch(text)).toThrow(RouteBatchParseError);
    });

    it("не пропускает произвольные команды ОС под видом .bat-синтаксиса", () => {
        const text = "start calc.exe";
        expect(() => parseRouteBatch(text)).toThrow(RouteBatchParseError);
    });

    it("не включает содержимое нераспознанной строки в .message (только в rawLine) — защита от утечки содержимого произвольного файла через текст ошибки", () => {
        const secretLookingLine = "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

        try {
            parseRouteBatch(secretLookingLine);
            expect.unreachable("ожидалось исключение RouteBatchParseError");
        } catch (error) {
            expect(error).toBeInstanceOf(RouteBatchParseError);
            const parseError = error as RouteBatchParseError;
            expect(parseError.rawLine).toBe(secretLookingLine);
            expect(parseError.message).not.toContain(secretLookingLine);
            expect(parseError.message).not.toContain("wJalrXUtnFEMI");
        }
    });
});

describe("buildRouteBatchPayload", () => {
    it("route-add собирает RCI-дерево для добавления маршрута", () => {
        const payload = buildRouteBatchPayload({
            kind: "route-add",
            line: 1,
            network: "10.0.5.0",
            mask: "255.255.255.0",
            iface: "ISP",
        });

        expect(payload).toEqual({
            ip: {route: [{network: "10.0.5.0", mask: "255.255.255.0", interface: "ISP"}]},
        });
    });

    it("route-delete собирает RCI-дерево с полем no:true", () => {
        const payload = buildRouteBatchPayload({
            kind: "route-delete",
            line: 1,
            network: "10.0.5.0",
            mask: "255.255.255.0",
        });

        expect(payload).toEqual({
            ip: {route: [{network: "10.0.5.0", mask: "255.255.255.0", no: true}]},
        });
    });
});

describe("applyRouteBatch", () => {
    it("partial-report: ошибка одной команды не блокирует остальные корректные", async () => {
        const commands = parseRouteBatch(
            ["ROUTE ADD 10.0.5.0 MASK 255.255.255.0 ISP", "ROUTE ADD 10.0.6.0 MASK 255.255.255.0 ISP"].join("\n"),
        );

        const transport: RouterTransport = {
            show: vi.fn(),
            exec: vi
                .fn()
                .mockResolvedValueOnce({status: "ok"})
                .mockRejectedValueOnce(new Error("роутер отклонил маршрут")),
        };

        const results = await applyRouteBatch(transport, commands);

        expect(results).toHaveLength(2);
        expect(results[0]).toMatchObject({line: commands[0].line, status: "applied"});
        expect(results[1]).toMatchObject({
            line: commands[1].line,
            status: "error",
            detail: expect.stringContaining("роутер отклонил маршрут")
        });
        expect(transport.exec).toHaveBeenCalledTimes(2);
    });

    it("все команды успешны — все помечены applied", async () => {
        const commands = parseRouteBatch("ROUTE DELETE 10.0.5.0 MASK 255.255.255.0");
        const transport: RouterTransport = {show: vi.fn(), exec: vi.fn().mockResolvedValue({status: "ok"})};

        const results = await applyRouteBatch(transport, commands);

        expect(results).toEqual([{line: 1, command: commands[0], payload: expect.any(Object), status: "applied"}]);
    });
});
