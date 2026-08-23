import {RouterTransport} from "../transport/types.js";

/** "ip/static" не читается через show() — подтверждённый batch-паттерн описан в skills/keenetic-fundamentals. */
export async function listPortForwards(transport: RouterTransport): Promise<unknown> {
    const result = (await transport.exec({show: {sc: {ip: {static: {}}}}})) as {
        show?: { sc?: { ip?: { static?: unknown } } };
    };
    return result.show?.sc?.ip?.static ?? [];
}

export interface PortForwardArgs {
    proto: "tcp" | "udp";
    externalPort: number;
    internalIp: string;
    internalPort: number;
    wanInterface: string;
}

/** Подтверждено вживую (массив объектов, поля "to-address"/"to-port") — см. skills/keenetic-fundamentals. */
export function buildAddPortForwardPayload(args: PortForwardArgs): Record<string, unknown> {
    return {
        ip: {
            static: [
                {
                    protocol: args.proto,
                    interface: args.wanInterface,
                    port: args.externalPort,
                    "to-address": args.internalIp,
                    "to-port": args.internalPort,
                },
            ],
        },
    };
}

export function addPortForward(transport: RouterTransport, args: PortForwardArgs) {
    return transport.exec(buildAddPortForwardPayload(args));
}

/** НЕ проверено на реальном роутере (собрано по аналогии с buildRemoveRoutePayload) — проверь dryRun перед боевым использованием. */
export function buildRemovePortForwardPayload(args: Pick<PortForwardArgs, "proto" | "externalPort">): Record<string, unknown> {
    return {
        ip: {
            static: [
                {
                    protocol: args.proto,
                    port: args.externalPort,
                    no: true,
                },
            ],
        },
    };
}

export function removePortForward(transport: RouterTransport, args: Pick<PortForwardArgs, "proto" | "externalPort">) {
    return transport.exec(buildRemovePortForwardPayload(args));
}

export function listRoutes(transport: RouterTransport): Promise<unknown> {
    return transport.show("ip/route");
}

export interface RouteArgs {
    network: string;
    mask: string;
    /** Имя интерфейса (например Wireguard0) или IP шлюза. */
    target: string;
}

/** Подтверждено на реальном роутере: массив объектов, а не дерево по ключу-сети. */
export function buildAddRoutePayload(args: RouteArgs): Record<string, unknown> {
    return {
        ip: {
            route: [
                {
                    network: args.network,
                    mask: args.mask,
                    interface: args.target,
                },
            ],
        },
    };
}

export function addRoute(transport: RouterTransport, args: RouteArgs) {
    return transport.exec(buildAddRoutePayload(args));
}

/** Подтверждено вживую: та же форма, что и add, плюс no:true внутри элемента (не внешняя обёртка). */
export function buildRemoveRoutePayload(args: Pick<RouteArgs, "network" | "mask">): Record<string, unknown> {
    return {
        ip: {
            route: [
                {
                    network: args.network,
                    mask: args.mask,
                    no: true,
                },
            ],
        },
    };
}

export function removeRoute(transport: RouterTransport, args: Pick<RouteArgs, "network" | "mask">) {
    return transport.exec(buildRemoveRoutePayload(args));
}

/** Тот же паттерн, что и listPortForwards — "ip/dhcp/host" не отдаётся через GET show. */
export async function listDhcpReservations(transport: RouterTransport): Promise<unknown> {
    const result = (await transport.exec({show: {sc: {ip: {dhcp: {host: {}}}}}})) as {
        show?: { sc?: { ip?: { dhcp?: { host?: unknown } } } };
    };
    return result.show?.sc?.ip?.dhcp?.host ?? [];
}
