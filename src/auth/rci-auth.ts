import {createHash} from "node:crypto";
import {RouterTransportError} from "../transport/types.js";

export class RciAuth {
    /**
     * Именованный jar, а не одна строка: если роутер когда-нибудь выставит больше одного cookie
     * за раз (например, отдельный CSRF-cookie вдобавок к сессии), обе пары должны накопиться,
     * а не вытеснить друг друга.
     */
    private readonly cookieJar = new Map<string, string>();
    private authenticated = false;
    private rejection: RouterTransportError | undefined;

    /**
     * Single-flight guard для login_(): два параллельных MCP tool call'а не должны запускать два
     * независимых doLogin() поверх общего cookie-состояния — GET/POST одного вызова могут
     * перемешаться с другим и получить не-200, что doLogin() трактует как явный отказ роутера и
     * кэширует НАВСЕГДА (см. rejection выше). Все конкурентные login_() ждут один и тот же промис;
     * это заодно снижает число реальных попыток логина к роутеру (см. brute-force lockout выше).
     */
    private inFlightLogin: Promise<void> | undefined;

    constructor(
        private readonly baseUrl: string,
        private readonly login: string,
        private readonly password: string,
    ) {
    }

    isAuthenticated(): boolean {
        return this.authenticated;
    }

    getCookie(): string | undefined {
        return this.cookieHeader();
    }

    invalidate(): void {
        this.authenticated = false;
    }

    async login_(): Promise<void> {
        if (this.rejection) {
            throw this.rejection;
        }

        if (!this.inFlightLogin) {
            this.inFlightLogin = this.attemptLogin().finally(() => {
                this.inFlightLogin = undefined;
            });
        }

        return this.inFlightLogin;
    }

    private async attemptLogin(): Promise<void> {
        try {
            await this.doLogin();
        } catch (error) {
            if (error instanceof RouterTransportError) {
                this.rejection = new RouterTransportError(
                    `${error.message} Логин/пароль читаются из окружения один раз при старте — после ` +
                    `исправления .env (или --env в конфиге MCP-сервера) нужно перезапустить сервер, ` +
                    `иначе он продолжит использовать старые значения.`,
                );
                throw this.rejection;
            }
            throw error;
        }
    }

    private async doLogin(): Promise<void> {
        const challengeResponse = await fetch(`${this.baseUrl}/auth`, {
            method: "GET",
            headers: this.buildHeaders(),
        });

        this.captureCookie(challengeResponse);

        const realm = challengeResponse.headers.get("x-ndm-realm");
        const challenge = challengeResponse.headers.get("x-ndm-challenge");

        if (!realm || !challenge) {
            throw new RouterTransportError(
                "RCI не вернул X-NDM-Realm/X-NDM-Challenge — проверьте адрес роутера и что RCI включён.",
            );
        }

        const md5 = createHash("md5").update(`${this.login}:${realm}:${this.password}`).digest("hex");
        const sha = createHash("sha256").update(`${challenge}${md5}`).digest("hex");

        const authResponse = await fetch(`${this.baseUrl}/auth`, {
            method: "POST",
            headers: this.buildHeaders({"Content-Type": "application/json"}),
            body: JSON.stringify({login: this.login, password: sha}),
        });

        this.captureCookie(authResponse);

        if (authResponse.status !== 200) {
            throw new RouterTransportError(
                `Авторизация на роутере не удалась (HTTP ${authResponse.status}) — проверьте ROUTER_LOGIN/ROUTER_PASSWORD.`,
            );
        }

        this.authenticated = true;
    }

    buildHeaders(extra?: Record<string, string>): Record<string, string> {
        const cookie = this.cookieHeader();
        return {
            ...(cookie ? {Cookie: cookie} : {}),
            ...extra,
        };
    }

    private cookieHeader(): string | undefined {
        if (this.cookieJar.size === 0) {
            return undefined;
        }
        return Array.from(this.cookieJar.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join("; ");
    }

    private captureCookie(response: Response): void {
        const setCookie =
            typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
                ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
                : response.headers.has("set-cookie")
                    ? [response.headers.get("set-cookie") as string]
                    : [];

        for (const raw of setCookie) {
            const pair = raw.split(";")[0];
            const eq = pair.indexOf("=");
            if (eq > 0) {
                this.cookieJar.set(pair.slice(0, eq), pair.slice(eq + 1));
            }
        }
    }
}
