import {config} from "../config.js";
import {auditLog, AuditEntry} from "../logging.js";

export type ToolTag = "read" | "write" | "destructive";

export interface GuardedArgs {
    /** Обязателен для write/destructive tools — защита от случайного вызова моделью. */
    confirm?: boolean;
    /** Если true — возвращает предполагаемый RCI payload и не отправляет его роутеру. */
    dryRun?: boolean;
}

interface GuardOptions<TArgs extends GuardedArgs> {
    toolName: string;
    tag: "write" | "destructive";
    args: TArgs;
    /** Строит RCI payload для предпросмотра (используется и в dryRun, и в аудит-логе). */
    buildPayload: (args: TArgs) => unknown;
    execute: (args: TArgs) => Promise<unknown>;
}

/**
 * Логирование — best-effort и не должно влиять на результат, который видит вызывающий.
 * Если запись в audit-log упадёт (диск занят/нет прав/каталог не существует) уже ПОСЛЕ того,
 * как операция реально была применена на роутере — эта ошибка не должна долететь до вызывающего
 * как признак неудачи самой операции: он может решить, что нужно повторить write, который на
 * самом деле уже произошёл. Поэтому здесь ошибка логирования только пишется в stderr, а не
 * выбрасывается наружу.
 */
async function safeAuditLog(entry: AuditEntry): Promise<void> {
    try {
        await auditLog(entry);
    } catch (error) {
        console.error("keenetic-router-plugin: не удалось записать audit-log (сама операция это не затрагивает):", error);
    }
}

/**
 * Единая точка, через которую обязаны проходить все write/destructive tools:
 * ALLOW_DESTRUCTIVE gate -> confirm gate -> dryRun preview -> execute -> audit log.
 */
export async function runGuarded<TArgs extends GuardedArgs>(opts: GuardOptions<TArgs>): Promise<unknown> {
    const {toolName, tag, args} = opts;

    if (tag === "destructive" && !config.allowDestructive) {
        await safeAuditLog({
            tool: toolName,
            tag,
            params: args,
            result: "rejected",
            detail: "ALLOW_DESTRUCTIVE не включён в конфигурации сервера",
        });
        throw new Error(
            `Tool "${toolName}" помечен как destructive и отключён. Включите ALLOW_DESTRUCTIVE=true в .env, если это осознанное решение.`,
        );
    }

    const payload = opts.buildPayload(args);

    if (args.dryRun) {
        await safeAuditLog({tool: toolName, tag, params: args, result: "dry-run"});
        return {dryRun: true, payload};
    }

    if (!args.confirm) {
        await safeAuditLog({
            tool: toolName,
            tag,
            params: args,
            result: "rejected",
            detail: "confirm флаг не передан",
        });
        throw new Error(
            `Tool "${toolName}" меняет состояние роутера и требует confirm: true. Сначала вызовите с dryRun: true, чтобы увидеть, что будет отправлено.`,
        );
    }

    try {
        const result = await opts.execute(args);
        await safeAuditLog({tool: toolName, tag, params: args, result: "applied"});
        return result;
    } catch (error) {
        await safeAuditLog({tool: toolName, tag, params: args, result: "error", detail: String(error)});
        throw error;
    }
}
