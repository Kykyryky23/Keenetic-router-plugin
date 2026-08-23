import {describe, expect, it, vi} from "vitest";

process.env.ROUTER_HOST ??= "192.0.2.1";
process.env.ROUTER_LOGIN ??= "admin";
process.env.ROUTER_PASSWORD ??= "test";

const statMock = vi.fn();
const readFileMock = vi.fn();
vi.mock("node:fs/promises", () => ({
    stat: (...args: unknown[]) => statMock(...args),
    readFile: (...args: unknown[]) => readFileMock(...args),
}));

vi.mock("../../src/logging.js", () => ({auditLog: vi.fn().mockResolvedValue(undefined)}));

const {registerTools} = await import("../../src/tools/register.js");

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: unknown; structuredContent: unknown }>;

/** Минимальная замена McpServer: реальный SDK-объект не нужен, важно только сохранить handler по имени тула. */
function createFakeServer() {
    const handlers = new Map<string, ToolHandler>();
    return {
        fake: {
            registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
                handlers.set(name, handler);
            },
        },
        handlers,
    };
}

describe("run_route_batch tool handler (через register.ts)", () => {
    it("отклоняет слишком большой файл ещё до readFile — размер проверяется первым", async () => {
        statMock.mockResolvedValue({size: 300 * 1024}); // > MAX_ROUTE_BATCH_FILE_BYTES (256 KiB)
        const {fake, handlers} = createFakeServer();
        const transport = {show: vi.fn(), exec: vi.fn()};

        registerTools(fake as any, transport as any);

        const handler = handlers.get("run_route_batch")!;
        await expect(handler({filePath: "C:\\fake\\huge.bat"})).rejects.toThrow(/слишком большой/);
        expect(readFileMock).not.toHaveBeenCalled();
    });

    it("dryRun возвращает предпросмотр без вызова transport.exec", async () => {
        statMock.mockResolvedValue({size: 100});
        readFileMock.mockResolvedValue("ROUTE ADD 10.0.5.0 MASK 255.255.255.0 ISP");
        const {fake, handlers} = createFakeServer();
        const transport = {show: vi.fn(), exec: vi.fn()};

        registerTools(fake as any, transport as any);

        const handler = handlers.get("run_route_batch")!;
        const result = await handler({filePath: "C:\\fake\\routes.bat", dryRun: true});

        expect(result.structuredContent).toMatchObject({dryRun: true});
        expect(transport.exec).not.toHaveBeenCalled();
    });

    it("confirm: true реально применяет и возвращает объектную форму {results: [...]}, не голый массив", async () => {
        statMock.mockResolvedValue({size: 100});
        readFileMock.mockResolvedValue("ROUTE ADD 10.0.5.0 MASK 255.255.255.0 ISP");
        const {fake, handlers} = createFakeServer();
        const transport = {show: vi.fn(), exec: vi.fn().mockResolvedValue({status: "ok"})};

        registerTools(fake as any, transport as any);

        const handler = handlers.get("run_route_batch")!;
        const result = await handler({filePath: "C:\\fake\\routes.bat", confirm: true});

        expect(result.structuredContent).toHaveProperty("results");
        expect(Array.isArray((result.structuredContent as { results: unknown }).results)).toBe(true);
        expect(transport.exec).toHaveBeenCalledTimes(1);
    });

    it("содержимое нераспознанной строки файла не попадает в текст ошибки", async () => {
        statMock.mockResolvedValue({size: 100});
        readFileMock.mockResolvedValue("SECRET_TOKEN=abc123verysecret");
        const {fake, handlers} = createFakeServer();
        const transport = {show: vi.fn(), exec: vi.fn()};

        registerTools(fake as any, transport as any);

        const handler = handlers.get("run_route_batch")!;
        try {
            await handler({filePath: "C:\\fake\\not-routes.bat", dryRun: true});
            expect.unreachable("ожидалась ошибка парсинга");
        } catch (error) {
            expect(String(error)).not.toContain("abc123verysecret");
        }
    });
});
