import {RouterTransport} from "../transport/types.js";
import {
    buildAddRoutePayload,
    buildRemoveRoutePayload,
} from "./network.js";
import {buildBindRouteToVpnPayload, buildUnbindRouteFromVpnPayload} from "./vpn.js";

/**
 * Ограниченный интерпретатор .bat-подобных файлов для пакетного применения маршрутов.
 * Файл НЕ выполняется системным интерпретатором (cmd.exe) — это исключает произвольное
 * исполнение команд ОС/роутера. Каждая строка обязана соответствовать одной из четырёх
 * известных форм, иначе весь батч отклоняется целиком ещё до применения (fail-closed).
 *
 * Поддерживаемая грамматика:
 *   :: комментарий
 *   ROUTE ADD <network> MASK <mask> <iface>
 *   ROUTE DELETE <network> MASK <mask>
 *   VPN BIND <network> MASK <mask> -> <iface>
 *   VPN UNBIND <network> MASK <mask>
 */

export type RouteBatchCommand =
    | { kind: "route-add"; line: number; network: string; mask: string; iface: string }
    | { kind: "route-delete"; line: number; network: string; mask: string }
    | { kind: "vpn-bind"; line: number; network: string; mask: string; iface: string }
    | { kind: "vpn-unbind"; line: number; network: string; mask: string };

const PATTERNS: Array<{ regex: RegExp; build: (m: RegExpMatchArray, line: number) => RouteBatchCommand }> = [
    {
        regex: /^ROUTE ADD (\S+) MASK (\S+) (\S+)$/i,
        build: (m, line) => ({kind: "route-add", line, network: m[1], mask: m[2], iface: m[3]}),
    },
    {
        regex: /^ROUTE DELETE (\S+) MASK (\S+)$/i,
        build: (m, line) => ({kind: "route-delete", line, network: m[1], mask: m[2]}),
    },
    {
        regex: /^VPN BIND (\S+) MASK (\S+) -> (\S+)$/i,
        build: (m, line) => ({kind: "vpn-bind", line, network: m[1], mask: m[2], iface: m[3]}),
    },
    {
        regex: /^VPN UNBIND (\S+) MASK (\S+)$/i,
        build: (m, line) => ({kind: "vpn-unbind", line, network: m[1], mask: m[2]}),
    },
];

export class RouteBatchParseError extends Error {
    constructor(
        readonly line: number,
        /**
         * Полная нераспознанная строка исходного файла — доступна программно (например, для
         * логирования на стороне сервера), но СОЗНАТЕЛЬНО не включена в `.message`. `filePath`
         * в run_route_batch — произвольный путь, читается ещё до confirm (нужно для dryRun-
         * предпросмотра, см. tools/register.ts); если бы содержимое строки попадало в `.message`,
         * который долетает до ответа MCP-инструмента, вызов с filePath, указывающим на чужой
         * секретный файл (.env, приватный ключ и т.п.), стал бы каналом утечки его содержимого
         * при любой ошибке парсинга — реальный риск при непроверенных путях от внешнего контента
         * (prompt injection). Тем, кому нужно увидеть саму строку — открыть файл напрямую.
         */
        readonly rawLine: string,
    ) {
        super(`Строка ${line} не распознана как команда batch-файла — проверьте синтаксис в файле напрямую.`);
        this.name = "RouteBatchParseError";
    }
}

/** Fail-closed: любая нераспознанная строка -> исключение, ничего не применяется. */
export function parseRouteBatch(text: string): RouteBatchCommand[] {
    const commands: RouteBatchCommand[] = [];

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        const lineNo = i + 1;

        if (trimmed.length === 0 || trimmed.startsWith("::") || trimmed.startsWith("REM ")) {
            continue;
        }

        let parsed: RouteBatchCommand | undefined;
        for (const pattern of PATTERNS) {
            const match = trimmed.match(pattern.regex);
            if (match) {
                parsed = pattern.build(match, lineNo);
                break;
            }
        }

        if (!parsed) {
            throw new RouteBatchParseError(lineNo, raw);
        }
        commands.push(parsed);
    }

    return commands;
}

export function buildRouteBatchPayload(command: RouteBatchCommand): Record<string, unknown> {
    switch (command.kind) {
        case "route-add":
            return buildAddRoutePayload({network: command.network, mask: command.mask, target: command.iface});
        case "route-delete":
            return buildRemoveRoutePayload({network: command.network, mask: command.mask});
        case "vpn-bind":
            return buildBindRouteToVpnPayload({network: command.network, mask: command.mask, target: command.iface});
        case "vpn-unbind":
            return buildUnbindRouteFromVpnPayload({network: command.network, mask: command.mask});
    }
}

export interface RouteBatchItemResult {
    line: number;
    command: RouteBatchCommand;
    payload: Record<string, unknown>;
    status: "applied" | "error";
    detail?: string;
}

/**
 * Применяет уже распарсенный батч построчно. В отличие от парсинга (fail-closed),
 * здесь ошибка одной команды не останавливает весь батч — репортится partial-report,
 * чтобы одна опечатка в маршруте не заблокировала остальные корректные строки.
 */
export async function applyRouteBatch(transport: RouterTransport, commands: RouteBatchCommand[]): Promise<RouteBatchItemResult[]> {
    const results: RouteBatchItemResult[] = [];

    for (const command of commands) {
        const payload = buildRouteBatchPayload(command);
        try {
            await transport.exec(payload);
            results.push({line: command.line, command, payload, status: "applied"});
        } catch (error) {
            results.push({line: command.line, command, payload, status: "error", detail: String(error)});
        }
    }

    return results;
}
