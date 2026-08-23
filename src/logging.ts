import {appendFile} from "node:fs/promises";
import {config} from "./config.js";

export interface AuditEntry {
    tool: string;
    tag: "write" | "destructive";
    params: unknown;
    result: "applied" | "dry-run" | "rejected" | "error";
    detail?: string;
}

const SECRET_KEY_PATTERN = /psk|password/i;

function redactSecrets(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(redactSecrets);
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, v]) => [
                key,
                SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(v),
            ]),
        );
    }
    return value;
}

/**
 * Собирает реальные (ещё не отредактированные) значения секретных полей из params. Нужно
 * ДО того, как redactSecrets() их заменит — используется отдельно, чтобы вычистить те же
 * значения из detail (см. ниже).
 */
function collectSecretValues(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) {
        for (const v of value) collectSecretValues(v, out);
    } else if (value !== null && typeof value === "object") {
        for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
            if (SECRET_KEY_PATTERN.test(key) && typeof v === "string" && v.length > 0) {
                out.push(v);
            } else {
                collectSecretValues(v, out);
            }
        }
    }
    return out;
}

/**
 * detail — это String(error) из ответа роутера/RCI. redactSecrets() чистит только params по
 * именам полей, но не помогает, если сам роутер эхом вернул присланное значение внутри текста
 * ошибки (некоторые API так делают: "invalid value: <то, что прислали>"). Поэтому здесь ищем и
 * маскируем конкретные секретные ЗНАЧЕНИЯ (не по имени поля, а по факту совпадения строки) —
 * те же, что были в params этого же вызова.
 */
function redactKnownValues(text: string, secrets: string[]): string {
    let result = text;
    for (const secret of secrets) {
        result = result.split(secret).join("[REDACTED]");
    }
    return result;
}

export async function auditLog(entry: AuditEntry): Promise<void> {
    const secretValues = collectSecretValues(entry.params);

    const line = JSON.stringify({
        timestamp: new Date().toISOString(),
        ...entry,
        params: redactSecrets(entry.params),
        detail: entry.detail !== undefined ? redactKnownValues(entry.detail, secretValues) : entry.detail,
    });
    await appendFile(config.auditLogPath, line + "\n", "utf8");
}
