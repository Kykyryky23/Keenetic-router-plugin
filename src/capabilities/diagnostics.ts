import {RouterTransport} from "../transport/types.js";

/**
 * Read-only диагностика. Пути ниже — стабильные и широко используемые RCI show-эндпоинты
 * (в т.ч. в сторонних интеграциях Keenetic) — сверьте их с реальным ответом роутера через
 * scripts/smoke.ts, на другой модели/прошивке они могут отличаться в деталях.
 */

export function getVersion(transport: RouterTransport): Promise<unknown> {
    return transport.show("version");
}

export function getSystemInfo(transport: RouterTransport): Promise<unknown> {
    return transport.show("system");
}

export function getInterfaces(transport: RouterTransport): Promise<unknown> {
    return transport.show("interface");
}

/** Список известных роутеру устройств (DHCP/hotspot host table): mac, ip, имя, интерфейс. */
export function listDevices(transport: RouterTransport): Promise<unknown> {
    return transport.show("ip/hotspot");
}

/** WAN не адресуется по rename ("ISP") — фильтруем полный список интерфейсов по рантайм-флагу "global": true. */
export async function getWanStatus(transport: RouterTransport): Promise<unknown> {
    const interfaces = (await transport.show("interface")) as Record<string, { global?: boolean }>;
    return Object.fromEntries(Object.entries(interfaces).filter(([, iface]) => iface?.global === true));
}

/** Read-only (не проходит через runGuarded), но содержит секреты в открытом виде — см. описание тула в register.ts. */
export async function exportConfig(transport: RouterTransport): Promise<string> {
    const result = (await transport.show("running-config")) as { message: string[] };
    return result.message.join("\n");
}
