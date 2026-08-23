import {RouterTransport} from "./types.js";

/**
 * Резерв на Phase 2: SSH CLI транспорт для случаев, которых нет в RCI
 * (в первую очередь — создание VPN-туннелей: WireGuard/OpenVPN/IPsec с генерацией
 * ключей и настройкой пиров, см. capabilities/vpn.ts). Не реализован в v1.
 *
 * Реализация должна удовлетворять тому же интерфейсу RouterTransport, чтобы
 * capabilities/tools слой не потребовал изменений при подключении SSH.
 */
export class SshCliTransport implements RouterTransport {
    show(_path: string): Promise<unknown> {
        throw new Error("SshCliTransport не реализован (Phase 2)");
    }

    exec(_commandTree: Record<string, unknown>): Promise<unknown> {
        throw new Error("SshCliTransport не реализован (Phase 2)");
    }
}
