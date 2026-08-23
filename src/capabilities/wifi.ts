import {RouterTransport} from "../transport/types.js";

/**
 * Точный RCI-путь интерфейса Wi-Fi (например "WifiMaster0/AccessPoint0" для основной
 * сети, "WifiMaster0/AccessPoint1" для гостевой) индивидуален для конкретного роутера
 * и должен быть взят из ответа diagnostics.getInterfaces() — не хардкодим здесь.
 */

export function listWifiClients(transport: RouterTransport): Promise<unknown> {
    return transport.show("associations");
}

export function buildSetWifiPasswordPayload(args: { interfaceId: string; psk: string }): Record<string, unknown> {
    if (args.psk.length < 8 || args.psk.length > 63) {
        throw new Error("WPA-PSK пароль должен быть длиной от 8 до 63 символов");
    }
    return {
        interface: {
            [args.interfaceId]: {
                authentication: {"wpa-psk": {psk: args.psk}},
            },
        },
    };
}

export function setWifiPassword(transport: RouterTransport, args: { interfaceId: string; psk: string }) {
    return transport.exec(buildSetWifiPasswordPayload(args));
}

export function buildSetWifiEnabledPayload(args: { interfaceId: string; enabled: boolean }): Record<string, unknown> {
    return {
        interface: {
            [args.interfaceId]: args.enabled ? {up: {}} : {down: {}},
        },
    };
}

export function setWifiEnabled(transport: RouterTransport, args: { interfaceId: string; enabled: boolean }) {
    return transport.exec(buildSetWifiEnabledPayload(args));
}
