import {afterEach, describe, expect, it, vi} from "vitest";

process.env.ROUTER_HOST ??= "192.0.2.1";
process.env.ROUTER_LOGIN ??= "admin";
process.env.ROUTER_PASSWORD ??= "test";

const appendFileMock = vi.fn().mockResolvedValue(undefined);
vi.mock("node:fs/promises", () => ({appendFile: (...args: unknown[]) => appendFileMock(...args)}));

const {auditLog} = await import("../../src/logging.js");

describe("auditLog", () => {
    afterEach(() => {
        appendFileMock.mockClear();
    });

    it("маскирует поля psk/password в params перед записью в лог", async () => {
        await auditLog({
            tool: "set_wifi_password",
            tag: "write",
            params: {interfaceId: "WifiMaster0/AccessPoint0", psk: "super-secret-wifi-password", confirm: true},
            result: "applied",
        });

        const [, writtenLine] = appendFileMock.mock.calls[0];
        const parsed = JSON.parse((writtenLine as string).trim());

        expect(parsed.params.psk).toBe("[REDACTED]");
        expect(parsed.params.interfaceId).toBe("WifiMaster0/AccessPoint0"); // не-секретные поля не трогаем
        expect(JSON.stringify(parsed)).not.toContain("super-secret-wifi-password");
    });

    it("не трогает params без секретных полей", async () => {
        await auditLog({
            tool: "add_route",
            tag: "write",
            params: {network: "10.0.5.0", mask: "255.255.255.0", target: "Wireguard2", confirm: true},
            result: "applied",
        });

        const [, writtenLine] = appendFileMock.mock.calls[0];
        const parsed = JSON.parse((writtenLine as string).trim());

        expect(parsed.params).toEqual({
            network: "10.0.5.0",
            mask: "255.255.255.0",
            target: "Wireguard2",
            confirm: true
        });
    });

    it("маскирует значение секрета и в detail, если роутер эхом вернул его в тексте ошибки", async () => {
        await auditLog({
            tool: "set_wifi_password",
            tag: "write",
            params: {interfaceId: "WifiMaster0/AccessPoint0", psk: "super-secret-wifi-password"},
            result: "error",
            detail: 'RouterTransportError: RCI POST /rci/ -> HTTP 400: invalid value: "super-secret-wifi-password"',
        });

        const [, writtenLine] = appendFileMock.mock.calls[0];
        const parsed = JSON.parse((writtenLine as string).trim());

        expect(parsed.detail).not.toContain("super-secret-wifi-password");
        expect(parsed.detail).toContain("[REDACTED]");
    });
});
