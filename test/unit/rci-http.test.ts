import {afterEach, describe, expect, it, vi} from "vitest";
import {RciHttpTransport} from "../../src/transport/rci-http.js";
import {RouterTransportError} from "../../src/transport/types.js";

function mockResponse(opts: {
    status: number;
    contentType?: string;
    body?: unknown;
    headers?: Record<string, string>
}) {
    const headerMap = new Map(Object.entries({...(opts.contentType ? {"content-type": opts.contentType} : {}), ...(opts.headers ?? {})}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        status: opts.status,
        ok: opts.status >= 200 && opts.status < 300,
        headers: {
            get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
            has: (name: string) => headerMap.has(name.toLowerCase()),
            getSetCookie: () => [],
        },
        json: async () => opts.body ?? {},
        text: async () => (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? {})),
    } as unknown as Response;
}

function stubAuthenticated(fetchMock: ReturnType<typeof vi.fn>) {
    fetchMock
        .mockResolvedValueOnce(
            mockResponse({status: 401, headers: {"x-ndm-realm": "R", "x-ndm-challenge": "C"}}),
        )
        .mockResolvedValueOnce(mockResponse({status: 200}));
}

describe("RciHttpTransport", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("exec() отправляет POST на /rci/ с обязательным слэшем на конце", async () => {
        const fetchMock = vi.fn();
        stubAuthenticated(fetchMock);
        fetchMock.mockResolvedValueOnce(mockResponse({status: 200, contentType: "application/json", body: {ok: true}}));
        vi.stubGlobal("fetch", fetchMock);

        const transport = new RciHttpTransport({host: "192.0.2.1", port: 80, login: "admin", password: "pass"});
        await transport.exec({ip: {route: []}});

        const execCall = fetchMock.mock.calls[2];
        expect(execCall[0]).toBe("http://192.0.2.1:80/rci/");
        expect((execCall[1] as RequestInit).method).toBe("POST");
    });

    it("show() запрашивает GET /rci/show/<path>", async () => {
        const fetchMock = vi.fn();
        stubAuthenticated(fetchMock);
        fetchMock.mockResolvedValueOnce(mockResponse({
            status: 200,
            contentType: "application/json",
            body: {version: "5.0.12"}
        }));
        vi.stubGlobal("fetch", fetchMock);

        const transport = new RciHttpTransport({host: "192.0.2.1", port: 80, login: "admin", password: "pass"});
        const result = await transport.show("version");

        const showCall = fetchMock.mock.calls[2];
        expect(showCall[0]).toBe("http://192.0.2.1:80/rci/show/version");
        expect((showCall[1] as RequestInit).method).toBe("GET");
        expect(result).toEqual({version: "5.0.12"});
    });

    it("при 401 на обычном запросе один раз повторно логинится и повторяет запрос", async () => {
        const fetchMock = vi.fn();
        stubAuthenticated(fetchMock);

        fetchMock.mockResolvedValueOnce(mockResponse({status: 401}));
        fetchMock
            .mockResolvedValueOnce(mockResponse({status: 401, headers: {"x-ndm-realm": "R", "x-ndm-challenge": "C2"}}))
            .mockResolvedValueOnce(mockResponse({status: 200}));
        fetchMock.mockResolvedValueOnce(mockResponse({status: 200, contentType: "application/json", body: {ok: true}}));
        vi.stubGlobal("fetch", fetchMock);

        const transport = new RciHttpTransport({host: "192.0.2.1", port: 80, login: "admin", password: "pass"});
        const result = await transport.show("version");

        expect(result).toEqual({ok: true});
        expect(fetchMock).toHaveBeenCalledTimes(6);
    });

    it("бросает RouterTransportError с текстом ответа при не-2xx (кроме 401-с-повтором)", async () => {
        const fetchMock = vi.fn();
        stubAuthenticated(fetchMock);
        fetchMock.mockResolvedValueOnce(mockResponse({status: 500, body: "internal error"}));
        vi.stubGlobal("fetch", fetchMock);

        const transport = new RciHttpTransport({host: "192.0.2.1", port: 80, login: "admin", password: "pass"});
        await expect(transport.show("version")).rejects.toThrow(RouterTransportError);
    });

    it("возвращает text(), если content-type не application/json", async () => {
        const fetchMock = vi.fn();
        stubAuthenticated(fetchMock);
        fetchMock.mockResolvedValueOnce(mockResponse({
            status: 200,
            contentType: "text/plain",
            body: "plain text body"
        }));
        vi.stubGlobal("fetch", fetchMock);

        const transport = new RciHttpTransport({host: "192.0.2.1", port: 80, login: "admin", password: "pass"});
        const result = await transport.show("self-test");

        expect(result).toBe("plain text body");
    });
});
