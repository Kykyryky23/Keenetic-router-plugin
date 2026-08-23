import {beforeEach, describe, expect, it, vi} from "vitest";

process.env.ROUTER_HOST ??= "192.0.2.1";
process.env.ROUTER_LOGIN ??= "admin";
process.env.ROUTER_PASSWORD ??= "test";

vi.mock("../../src/logging.js", () => ({auditLog: vi.fn().mockResolvedValue(undefined)}));

const {config} = await import("../../src/config.js");
const {runGuarded} = await import("../../src/tools/guard.js");
const {auditLog} = await import("../../src/logging.js");

describe("runGuarded", () => {
    beforeEach(() => {
        config.allowDestructive = false;
    });

    it("отклоняет write-вызов без confirm, ничего не выполняя", async () => {
        const execute = vi.fn();
        await expect(
            runGuarded({
                toolName: "test_tool",
                tag: "write",
                args: {},
                buildPayload: () => ({ok: true}),
                execute,
            }),
        ).rejects.toThrow(/confirm/);
        expect(execute).not.toHaveBeenCalled();
    });

    it("dryRun возвращает payload и не выполняет execute", async () => {
        const execute = vi.fn();
        const result = await runGuarded({
            toolName: "test_tool",
            tag: "write",
            args: {dryRun: true},
            buildPayload: () => ({ok: true}),
            execute,
        });

        expect(result).toEqual({dryRun: true, payload: {ok: true}});
        expect(execute).not.toHaveBeenCalled();
    });

    it("confirm: true выполняет execute", async () => {
        const execute = vi.fn().mockResolvedValue({done: true});
        const result = await runGuarded({
            toolName: "test_tool",
            tag: "write",
            args: {confirm: true},
            buildPayload: () => ({ok: true}),
            execute,
        });

        expect(result).toEqual({done: true});
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it("destructive-вызов отклоняется, если ALLOW_DESTRUCTIVE выключен, даже с confirm: true", async () => {
        const execute = vi.fn();
        await expect(
            runGuarded({
                toolName: "reboot_router",
                tag: "destructive",
                args: {confirm: true},
                buildPayload: () => ({}),
                execute,
            }),
        ).rejects.toThrow(/ALLOW_DESTRUCTIVE/);
        expect(execute).not.toHaveBeenCalled();
    });

    it("destructive-вызов проходит, если ALLOW_DESTRUCTIVE включён и confirm: true", async () => {
        config.allowDestructive = true;
        const execute = vi.fn().mockResolvedValue({rebooted: true});
        const result = await runGuarded({
            toolName: "reboot_router",
            tag: "destructive",
            args: {confirm: true},
            buildPayload: () => ({}),
            execute,
        });
        expect(result).toEqual({rebooted: true});
    });

    it("сбой записи audit-log ПОСЛЕ успешного execute не маскирует успех операции", async () => {
        vi.mocked(auditLog).mockRejectedValueOnce(new Error("ENOSPC: диск заполнен"));
        const execute = vi.fn().mockResolvedValue({applied: true});

        const result = await runGuarded({
            toolName: "test_tool",
            tag: "write",
            args: {confirm: true},
            buildPayload: () => ({ok: true}),
            execute,
        });

        // Операция реально применилась — сбой логирования не должен превратить успех в исключение.
        expect(result).toEqual({applied: true});
    });

    it("сбой записи audit-log при реальной ошибке execute не подменяет собой содержательную ошибку", async () => {
        vi.mocked(auditLog).mockRejectedValueOnce(new Error("ENOSPC: диск заполнен"));
        const execute = vi.fn().mockRejectedValue(new Error("роутер вернул ошибку RCI"));

        await expect(
            runGuarded({
                toolName: "test_tool",
                tag: "write",
                args: {confirm: true},
                buildPayload: () => ({ok: true}),
                execute,
            }),
        ).rejects.toThrow(/роутер вернул ошибку RCI/); // не "ENOSPC" из сбоя логирования
    });
});
