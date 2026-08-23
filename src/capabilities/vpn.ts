import {RouterTransport} from "../transport/types.js";
import {buildAddRoutePayload, buildRemoveRoutePayload, RouteArgs} from "./network.js";

/**
 * только policy-routing к УЖЕ существующему на роутере VPN-интерфейсу
 * (создан заранее вручную в веб-интерфейсе). Технически это тот же механизм,
 * что и обычный статический маршрут (network.ts) — цель которого указывает на
 * VPN-интерфейс вместо WAN.
 */

/** Только "Wireguard" подтверждён вживую, остальные — best-effort; детали в skills/keenetic-fundamentals. */
const VPN_INTERFACE_TYPE_PATTERNS = [/wireguard/i, /openvpn/i, /ikev2/i, /l2tp/i, /pptp/i, /vless/i];

export async function listVpnInterfaces(transport: RouterTransport): Promise<unknown> {
    const interfaces = (await transport.show("interface")) as Record<string, { type?: string }>;
    return Object.fromEntries(
        Object.entries(interfaces).filter(
            ([, iface]) => typeof iface?.type === "string" && VPN_INTERFACE_TYPE_PATTERNS.some((p) => p.test(iface.type as string)),
        ),
    );
}

export type VpnRouteArgs = RouteArgs;

export function buildBindRouteToVpnPayload(args: VpnRouteArgs): Record<string, unknown> {
    return buildAddRoutePayload(args);
}

export function bindRouteToVpn(transport: RouterTransport, args: VpnRouteArgs) {
    return transport.exec(buildBindRouteToVpnPayload(args));
}

export function buildUnbindRouteFromVpnPayload(args: Pick<VpnRouteArgs, "network" | "mask">): Record<string, unknown> {
    return buildRemoveRoutePayload(args);
}

export function unbindRouteFromVpn(transport: RouterTransport, args: Pick<VpnRouteArgs, "network" | "mask">) {
    return transport.exec(buildUnbindRouteFromVpnPayload(args));
}

/**
 * Phase 2 (не реализовано намеренно): создание VPN-туннеля с нуля (WireGuard/OpenVPN/IPsec —
 * генерация ключей, настройка peer'ов). Скорее всего потребует SshCliTransport и/или отдельной
 * разведки RCI-веток для конкретного типа VPN на реальном роутере пользователя.
 */
export function createVpnTunnel(_transport: RouterTransport, _args: unknown): Promise<never> {
    return Promise.reject(
        new Error(
            "createVpnTunnel не реализован в v1. Требует Phase 2: SSH CLI транспорт и/или разведку RCI для конкретного типа VPN.",
        ),
    );
}
