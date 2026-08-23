import {RciAuth} from "../auth/rci-auth.js";
import {RouterTransport, RouterTransportError} from "./types.js";

export interface RciHttpTransportOptions {
    host: string;
    port: number;
    login: string;
    password: string;
}

/**
 * RouterTransport поверх RCI HTTP API
 * SSH CLI транспорт (ssh-cli.ts) реализует тот же интерфейс — capabilities/tools
 * слой от конкретного транспорта не зависит
 */
export class RciHttpTransport implements RouterTransport {
    private readonly baseUrl: string;
    private readonly auth: RciAuth;

    constructor(options: RciHttpTransportOptions) {
        this.baseUrl = `http://${options.host}:${options.port}`;
        this.auth = new RciAuth(this.baseUrl, options.login, options.password);
    }

    async show(path: string): Promise<unknown> {
        return this.request("GET", `/rci/show/${trimSlashes(path)}`);
    }

    async exec(commandTree: Record<string, unknown>): Promise<unknown> {
        // Обязателен слэш на конце — POST /rci (без слэша) отдаёт 405 на реальном роутере,
        // хотя GET /rci/show/... без слэша работает нормально. Проверено на живом устройстве.
        return this.request("POST", "/rci/", commandTree);
    }

    private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
        if (!this.auth.isAuthenticated()) {
            await this.auth.login_();
        }

        let response = await this.send(method, path, body);

        if (response.status === 401) {
            this.auth.invalidate();
            await this.auth.login_();
            response = await this.send(method, path, body);
        }

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new RouterTransportError(`RCI ${method} ${path} -> HTTP ${response.status}: ${text}`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
            return response.json();
        }
        return response.text();
    }

    private send(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
        return fetch(`${this.baseUrl}${path}`, {
            method,
            headers: this.auth.buildHeaders(body !== undefined ? {"Content-Type": "application/json"} : undefined),
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    }
}

function trimSlashes(path: string): string {
    return path.replace(/^\/+/, "");
}
