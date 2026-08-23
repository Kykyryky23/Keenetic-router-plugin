import {createHash} from "node:crypto";
import {afterEach, describe, expect, it, vi} from "vitest";
import {RciAuth} from "../../src/auth/rci-auth.js";
import {RouterTransportError} from "../../src/transport/types.js";

function mockResponse(opts: {
    status: number;
    headers?: Record<string, string>;
    setCookie?: string[];
    body?: unknown;
}) {
    const headerMap = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        status: opts.status,
        ok: opts.status >= 200 && opts.status < 300,
        headers: {
            get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
            has: (name: string) => headerMap.has(name.toLowerCase()),
            getSetCookie: () => opts.setCookie ?? [],
        },
        json: async () => opts.body ?? {},
        text: async () => (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? {})),
    } as unknown as Response;
}

describe("RciAuth", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("проходит challenge-response и вычисляет sha256(challenge + md5(login:realm:password))", async () => {

        const challenge = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
        const realm = "TestRouter";
        const login = "testuser";
        const password = "test-password-1234";
        const expectedMd5 = "3afc87bd1e0e6633f548ffe6ab6a6652";
        const expectedSha = "0334b8fd976f68df25145bdcd86215bd6f7e412f08202bd3708a1d586eaa7c22";

        // Подстраховка: expectedMd5/expectedSha посчитаны отдельным скриптом (не этим тестом),
        // так что если кто-то поменяет фикстуру выше, не пересчитав их, тест не останется молча зелёным.
        expect(createHash("md5").update(`${login}:${realm}:${password}`).digest("hex")).toBe(expectedMd5);
        expect(createHash("sha256").update(`${challenge}${expectedMd5}`).digest("hex")).toBe(expectedSha);

        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                mockResponse({
                    status: 401,
                    headers: {"x-ndm-realm": realm, "x-ndm-challenge": challenge},
                    setCookie: ["SESSION=abc123; Path=/"],
                }),
            )
            .mockResolvedValueOnce(mockResponse({status: 200, setCookie: ["SESSION=abc123; Path=/"]}));

        vi.stubGlobal("fetch", fetchMock);

        const auth = new RciAuth("http://192.0.2.1", login, password);
        await auth.login_();

        expect(auth.isAuthenticated()).toBe(true);
        expect(auth.getCookie()).toBe("SESSION=abc123");

        const postCall = fetchMock.mock.calls[1];
        expect(postCall[0]).toBe("http://192.0.2.1/auth");
        const postBody = JSON.parse((postCall[1] as RequestInit).body as string);
        expect(postBody).toEqual({login, password: expectedSha});
    });

    it("бросает ошибку, если роутер не вернул X-NDM-Realm/X-NDM-Challenge", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(mockResponse({status: 401, headers: {}})),
        );

        const auth = new RciAuth("http://192.0.2.1", "admin", "wrong");
        await expect(auth.login_()).rejects.toThrow(RouterTransportError);
    });

    it("после явного отказа роутера запоминает это насовсем и больше не обращается в сеть", async () => {
        const fetchMock = vi.fn().mockResolvedValue(mockResponse({status: 401, headers: {}}));
        vi.stubGlobal("fetch", fetchMock);

        const auth = new RciAuth("http://192.0.2.1", "admin", "wrong");

        await expect(auth.login_()).rejects.toThrow(RouterTransportError);
        const callsAfterFirstFailure = fetchMock.mock.calls.length;
        expect(callsAfterFirstFailure).toBeGreaterThan(0);

        await expect(auth.login_()).rejects.toThrow(RouterTransportError);
        await expect(auth.login_()).rejects.toThrow(/перезапустить сервер/);
        expect(fetchMock.mock.calls.length).toBe(callsAfterFirstFailure);
    });

    it("несколько Set-Cookie от роутера накапливаются в jar'е, а не вытесняют друг друга", async () => {

        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                mockResponse({
                    status: 401,
                    headers: {"x-ndm-realm": "R", "x-ndm-challenge": "C"},
                    setCookie: ["SESSION=abc123; Path=/", "CSRF=xyz789; Path=/"],
                }),
            )
            .mockResolvedValueOnce(mockResponse({status: 200, setCookie: []}));
        vi.stubGlobal("fetch", fetchMock);

        const auth = new RciAuth("http://192.0.2.1", "admin", "pass");
        await auth.login_();

        expect(auth.getCookie()).toBe("SESSION=abc123; CSRF=xyz789");
    });

    it("два параллельных login_() выполняют только один реальный логин (single-flight)", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                mockResponse({
                    status: 401,
                    headers: {"x-ndm-realm": "R", "x-ndm-challenge": "C"},
                    setCookie: ["SESSION=abc; Path=/"],
                }),
            )
            .mockResolvedValueOnce(mockResponse({status: 200, setCookie: ["SESSION=abc; Path=/"]}));
        vi.stubGlobal("fetch", fetchMock);

        const auth = new RciAuth("http://192.0.2.1", "admin", "pass");

        await Promise.all([auth.login_(), auth.login_()]);

        expect(fetchMock.mock.calls.length).toBe(2);
        expect(auth.isAuthenticated()).toBe(true);
    });

    it("сетевую ошибку (не явный отказ роутера) не запоминает — следующий вызов пробует снова", async () => {
        const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed"));
        fetchMock.mockResolvedValueOnce(
            mockResponse({
                status: 401,
                headers: {"x-ndm-realm": "R", "x-ndm-challenge": "C"},
                setCookie: ["S=1; Path=/"],
            }),
        );
        fetchMock.mockResolvedValueOnce(mockResponse({status: 200, setCookie: ["S=1; Path=/"]}));
        vi.stubGlobal("fetch", fetchMock);

        const auth = new RciAuth("http://192.0.2.1", "admin", "pass");

        await expect(auth.login_()).rejects.toThrow(TypeError);
        await auth.login_();
        expect(auth.isAuthenticated()).toBe(true);
    });
});
