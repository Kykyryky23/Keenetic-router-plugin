import {fileURLToPath} from "node:url";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Сервер регистрируется с scope "user" и может запускаться с любым
 * текущим рабочим каталогом (тем, что открыт в конкретной сессии/проекте), поэтому
 * .env нельзя искать через process.cwd() — ищем его рядом с самим проектом, независимо
 * от того, откуда процесс был запущен
 * */
const projectRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
dotenv.config({path: path.join(projectRoot, ".env")});

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function port(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === "") {
        return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid ${name}: "${raw}" — expected an integer port number between 1 and 65535`);
    }
    return parsed;
}

export const config = {
    routerHost: required("ROUTER_HOST"),
    routerPort: port("ROUTER_PORT", 80),
    routerLogin: required("ROUTER_LOGIN"),
    routerPassword: required("ROUTER_PASSWORD"),
    allowDestructive: (process.env.ALLOW_DESTRUCTIVE ?? "false").toLowerCase() === "true",
    auditLogPath: process.env.AUDIT_LOG_PATH ?? path.join(projectRoot, "audit.log"),
};

export type Config = typeof config;
