import {readFile, stat} from "node:fs/promises";
import {z} from "zod";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {RouterTransport} from "../transport/types.js";
import {runGuarded} from "./guard.js";
import * as diagnostics from "../capabilities/diagnostics.js";
import * as wifi from "../capabilities/wifi.js";
import * as network from "../capabilities/network.js";
import * as vpn from "../capabilities/vpn.js";
import * as service from "../capabilities/service.js";
import {
    applyRouteBatch,
    buildRouteBatchPayload,
    parseRouteBatch,
    RouteBatchParseError
} from "../capabilities/routes-batch.js";

function json(data: unknown) {
    return {
        content: [{type: "text" as const, text: JSON.stringify(data, null, 2)}],
        structuredContent: data as Record<string, unknown>,
    };
}

/** Легитимный batch-файл маршрутов — это несколько строк, не гигабайты; защита от случайной ошибки в пути. */
const MAX_ROUTE_BATCH_FILE_BYTES = 256 * 1024;

const confirmField = z.boolean().optional().describe("Обязательно true, чтобы реально применить изменение на роутере.");
const dryRunField = z
    .boolean()
    .optional()
    .describe("Если true — вернуть RCI payload без отправки на роутер (предпросмотр).");

export function registerTools(server: McpServer, transport: RouterTransport): void {

    server.registerTool(
        "get_version",
        {
            title: "Версия прошивки",
            description: "Версия KeeneticOS и модель роутера.",
            inputSchema: z.object({}).strict()
        },
        async () => json(await diagnostics.getVersion(transport)),
    );

    server.registerTool(
        "check_firmware_update",
        {
            title: "Проверить обновление прошивки",
            description:
                "Проверяет через компонентный менеджер роутера, доступна ли новая версия KeeneticOS в " +
                "настроенном канале обновлений. ТРЕБУЕТ прав основного аккаунта admin — под менее " +
                "привилегированным аккаунтом роутер отвечает ошибкой \"execute denied\" (подтверждено " +
                "вживую на роутере разработки под непривилегированным аккаунтом). Это ограничение самого " +
                "RCI, а не баг инструмента: если получена такая ошибка, сообщи пользователю, что нужен " +
                "admin-аккаунт в конфигурации MCP-сервера (ROUTER_LOGIN/ROUTER_PASSWORD), и не пытайся " +
                "обойти это иначе.",
            inputSchema: z.object({}).strict(),
            annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true},
        },
        async () => json(await diagnostics.checkFirmwareUpdate(transport)),
    );

    server.registerTool(
        "get_system_info",
        {
            title: "Системная информация",
            description: "Аптайм, загрузка, память и т.п.",
            inputSchema: z.object({}).strict()
        },
        async () => json(await diagnostics.getSystemInfo(transport)),
    );

    server.registerTool(
        "get_interfaces",
        {
            title: "Список интерфейсов",
            description: "Все сетевые интерфейсы роутера (WAN, Wi-Fi, VPN, мосты) и их состояние.",
            inputSchema: z.object({}).strict(),
        },
        async () => json(await diagnostics.getInterfaces(transport)),
    );

    server.registerTool(
        "list_devices",
        {
            title: "Подключённые устройства",
            description: "Список устройств из таблицы DHCP/hotspot: MAC, IP, имя, интерфейс.",
            inputSchema: z.object({}).strict(),
        },
        async () => json(await diagnostics.listDevices(transport)),
    );

    server.registerTool(
        "get_wan_status",
        {
            title: "Статус WAN",
            description: "Состояние основного интернет-подключения.",
            inputSchema: z.object({}).strict()
        },
        async () => json(await diagnostics.getWanStatus(transport)),
    );

    server.registerTool(
        "list_wifi_clients",
        {
            title: "Клиенты Wi-Fi",
            description: "Устройства, ассоциированные с точками доступа.",
            inputSchema: z.object({}).strict()
        },
        async () => json(await wifi.listWifiClients(transport)),
    );

    server.registerTool(
        "list_port_forwards",
        {
            title: "Список port forwarding",
            description: "Текущие правила проброса портов.",
            inputSchema: z.object({}).strict()
        },
        async () => json(await network.listPortForwards(transport)),
    );

    server.registerTool(
        "list_routes",
        {
            title: "Список маршрутов",
            description: "Таблица статических маршрутов роутера.",
            inputSchema: z.object({}).strict()
        },
        async () => json(await network.listRoutes(transport)),
    );

    server.registerTool(
        "list_dhcp_reservations",
        {title: "DHCP-резервации", description: "Статические привязки IP к MAC.", inputSchema: z.object({}).strict()},
        async () => json(await network.listDhcpReservations(transport)),
    );

    server.registerTool(
        "list_vpn_interfaces",
        {
            title: "VPN-интерфейсы",
            description:
                "Отфильтрованный список интерфейсов роутера — только VPN-туннели (WireGuard подтверждён вживую; " +
                "OpenVPN/IKEv2/L2TP/PPTP/VLESS — по типу, не проверено на реальном роутере). Используй для " +
                "последующей привязки маршрутов (bind_route_to_vpn).",
            inputSchema: z.object({}).strict(),
        },
        async () => json(await vpn.listVpnInterfaces(transport)),
    );

    server.registerTool(
        "export_config",
        {
            title: "Экспорт конфигурации (бэкап)",
            description:
                "Возвращает полный running-config роутера текстом (CLI-синтаксис) — та же информация, что и кнопка " +
                "\"Сохранить\" у running-config в веб-интерфейсе (Управление → Настройки системы → Системные файлы). " +
                "ВАЖНО: результат содержит секреты в открытом/слабо обфусцированном виде — хэши паролей пользователей, " +
                "WPA-PSK Wi-Fi, параметры WireGuard. Перед вызовом предупреди пользователя об этом. После получения " +
                "результата не пересказывай и не цитируй секретные значения без необходимости; если пользователь просит " +
                "сохранить бэкап — предложи записать его в файл вне git-репозитория (в нём секреты в открытом виде), а не " +
                "просто оставить текст в переписке.",
            inputSchema: z.object({}).strict(),
            annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
        },
        async () => json({configText: await diagnostics.exportConfig(transport)}),
    );

    const wifiPasswordSchema = z
        .object({
            interfaceId: z.string().describe('RCI id интерфейса Wi-Fi, например "WifiMaster0/AccessPoint0" (см. get_interfaces).'),
            psk: z.string().min(8).max(63).describe("Новый пароль WPA-PSK, 8–63 символа."),
            confirm: confirmField,
            dryRun: dryRunField,
        })
        .strict();

    server.registerTool(
        "set_wifi_password",
        {
            title: "Сменить пароль Wi-Fi",
            description: "Устанавливает новый WPA-PSK пароль на указанной точке доступа.",
            inputSchema: wifiPasswordSchema,
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
        },
        async (args) =>
            json(
                await runGuarded({
                    toolName: "set_wifi_password",
                    tag: "write",
                    args,
                    buildPayload: wifi.buildSetWifiPasswordPayload,
                    execute: (a) => wifi.setWifiPassword(transport, a),
                }),
            ),
    );

    const wifiEnabledSchema = z
        .object({
            interfaceId: z.string().describe("RCI id интерфейса Wi-Fi (см. get_interfaces)."),
            enabled: z.boolean(),
            confirm: confirmField,
            dryRun: dryRunField,
        })
        .strict();

    server.registerTool(
        "set_wifi_enabled",
        {
            title: "Включить/выключить Wi-Fi сеть",
            description: "Поднимает или гасит указанную точку доступа (например гостевую сеть).",
            inputSchema: wifiEnabledSchema,
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
        },
        async (args) =>
            json(
                await runGuarded({
                    toolName: "set_wifi_enabled",
                    tag: "write",
                    args,
                    buildPayload: wifi.buildSetWifiEnabledPayload,
                    execute: (a) => wifi.setWifiEnabled(transport, a),
                }),
            ),
    );

    const addPortForwardSchema = z
        .object({
            proto: z.enum(["tcp", "udp"]),
            externalPort: z.number().int().min(1).max(65535),
            internalIp: z.string(),
            internalPort: z.number().int().min(1).max(65535),
            wanInterface: z.string().describe("RCI id WAN-интерфейса (см. get_interfaces)."),
            confirm: confirmField,
            dryRun: dryRunField,
        })
        .strict();

    server.registerTool(
        "add_port_forward",
        {
            title: "Добавить проброс порта",
            description: "Создаёт правило port forwarding с внешнего порта на внутренний IP:порт.",
            inputSchema: addPortForwardSchema,
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
        },
        async (args) =>
            json(
                await runGuarded({
                    toolName: "add_port_forward",
                    tag: "write",
                    args,
                    buildPayload: network.buildAddPortForwardPayload,
                    execute: (a) => network.addPortForward(transport, a),
                }),
            ),
    );

    const removePortForwardSchema = z
        .object({
            proto: z.enum(["tcp", "udp"]),
            externalPort: z.number().int().min(1).max(65535),
            confirm: confirmField,
            dryRun: dryRunField,
        })
        .strict();

    server.registerTool(
        "remove_port_forward",
        {
            title: "Удалить проброс порта",
            description: "Удаляет ранее созданное правило port forwarding.",
            inputSchema: removePortForwardSchema,
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
        },
        async (args) =>
            json(
                await runGuarded({
                    toolName: "remove_port_forward",
                    tag: "write",
                    args,
                    buildPayload: network.buildRemovePortForwardPayload,
                    execute: (a) => network.removePortForward(transport, a),
                }),
            ),
    );

    const routeSchema = z
        .object({
            network: z.string().describe("Адрес сети, например 10.0.5.0"),
            mask: z.string().describe("Маска подсети, например 255.255.255.0"),
            target: z.string().describe("Имя интерфейса или IP шлюза, куда направить маршрут."),
            confirm: confirmField,
            dryRun: dryRunField,
        })
        .strict();

    server.registerTool(
        "add_route",
        {
            title: "Добавить маршрут",
            description: "Добавляет статический маршрут.",
            inputSchema: routeSchema,
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
        },
        async (args) =>
            json(
                await runGuarded({
                    toolName: "add_route",
                    tag: "write",
                    args,
                    buildPayload: network.buildAddRoutePayload,
                    execute: (a) => network.addRoute(transport, a),
                }),
            ),
    );

    const removeRouteSchema = z
        .object({
            network: z.string(),
            mask: z.string(),
            confirm: confirmField,
            dryRun: dryRunField,
        })
        .strict();

    server.registerTool(
        "remove_route",
        {
            title: "Удалить маршрут",
            description: "Удаляет статический маршрут.",
            inputSchema: removeRouteSchema,
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
        },
        async (args) =>
            json(
                await runGuarded({
                    toolName: "remove_route",
                    tag: "write",
                    args,
                    buildPayload: network.buildRemoveRoutePayload,
                    execute: (a) => network.removeRoute(transport, a),
                }),
            ),
    );

    server.registerTool(
        "bind_route_to_vpn",
        {
            title: "Привязать маршрут к VPN",
            description: "Направляет трафик указанной сети через уже настроенный на роутере VPN-интерфейс (policy-based routing).",
            inputSchema: routeSchema,
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
        },
        async (args) =>
            json(
                await runGuarded({
                    toolName: "bind_route_to_vpn",
                    tag: "write",
                    args,
                    buildPayload: vpn.buildBindRouteToVpnPayload,
                    execute: (a) => vpn.bindRouteToVpn(transport, a),
                }),
            ),
    );

    server.registerTool(
        "unbind_route_from_vpn",
        {
            title: "Отвязать маршрут от VPN",
            description: "Убирает привязку сети к VPN-интерфейсу.",
            inputSchema: removeRouteSchema,
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
        },
        async (args) =>
            json(
                await runGuarded({
                    toolName: "unbind_route_from_vpn",
                    tag: "write",
                    args,
                    buildPayload: vpn.buildUnbindRouteFromVpnPayload,
                    execute: (a) => vpn.unbindRouteFromVpn(transport, a),
                }),
            ),
    );

    const routeBatchSchema = z
        .object({
            filePath: z.string().describe("Путь к .bat-файлу с маршрутами в поддерживаемой грамматике (см. examples/route-batch.example.bat)."),
            confirm: confirmField,
            dryRun: dryRunField,
        })
        .strict();

    server.registerTool(
        "run_route_batch",
        {
            title: "Пакетно применить маршруты из .bat-файла",
            description:
                "Читает .bat-файл, разбирает его ограниченной грамматикой (ROUTE ADD/DELETE, VPN BIND/UNBIND) и применяет построчно. " +
                "Файл не исполняется системным интерпретатором — только заранее известные команды. Любая нераспознанная строка отклоняет весь батч " +
                "(fail-closed) ещё до применения. dryRun возвращает все RCI payload'ы без отправки на роутер.",
            inputSchema: routeBatchSchema,
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false},
        },
        async (args) => {
            const stats = await stat(args.filePath);
            if (stats.size > MAX_ROUTE_BATCH_FILE_BYTES) {
                throw new Error(
                    `Файл слишком большой для batch-маршрутов (${stats.size} байт, максимум ${MAX_ROUTE_BATCH_FILE_BYTES}) — проверьте путь: возможно, указан не тот файл.`,
                );
            }

            const text = await readFile(args.filePath, "utf8");
            const commands = parseRouteBatch(text);

            const result = await runGuarded({
                toolName: "run_route_batch",
                tag: "write",
                args,
                buildPayload: () => commands.map((c) => ({
                    line: c.line,
                    command: c,
                    payload: buildRouteBatchPayload(c)
                })),
                execute: async () => ({results: await applyRouteBatch(transport, commands)}),
            });

            return json(result);
        },
    );

    server.registerTool(
        "reboot_router",
        {
            title: "Перезагрузить роутер",
            description:
                "Немедленная перезагрузка роутера. Требует ALLOW_DESTRUCTIVE=true в конфигурации сервера. " +
                "RCI-форма запроса НЕ проверена вживую на реальном устройстве в рамках этого проекта — " +
                "рекомендуется сначала dryRun и явное подтверждение пользователя перед первым использованием.",
            inputSchema: z.object({confirm: confirmField, dryRun: dryRunField}).strict(),
            annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false},
        },
        async (args) =>
            json(
                await runGuarded({
                    toolName: "reboot_router",
                    tag: "destructive",
                    args,
                    buildPayload: service.buildRebootPayload,
                    execute: () => service.reboot(transport),
                }),
            ),
    );
}

export {RouteBatchParseError};
