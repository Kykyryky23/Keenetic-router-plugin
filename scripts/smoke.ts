/**
 * Live smoke-test: только read-only обращения к реальному роутеру из .env.
 * Ничего не меняет на роутере. Запуск: npm run smoke
 *
 * Цель — проверить (1) что авторизация проходит и (2) что show-эндпоинты
 * действительно возвращают ожидаемую структуру на конкретной прошивке
 * пользователя (см. план: "Что нужно проверить/доразведать")
 */
import {config} from "../src/config.js";
import {RciHttpTransport} from "../src/transport/rci-http.js";
import * as diagnostics from "../src/capabilities/diagnostics.js";
import * as network from "../src/capabilities/network.js";
import * as vpn from "../src/capabilities/vpn.js";
import * as wifi from "../src/capabilities/wifi.js";

async function tryCall(name: string, fn: () => Promise<unknown>): Promise<boolean> {
    process.stdout.write(`\n--- ${name} ---\n`);
    try {
        const result = await fn();
        console.log(JSON.stringify(result, null, 2));
        return true;
    } catch (error) {
        console.error(`ОШИБКА: ${String(error)}`);
        return false;
    }
}

async function main(): Promise<void> {
    const transport = new RciHttpTransport({
        host: config.routerHost,
        port: config.routerPort,
        login: config.routerLogin,
        password: config.routerPassword,
    });

    const authOk = await tryCall("get_version", () => diagnostics.getVersion(transport));
    if (!authOk) {
        console.error(
            "\nПервый же запрос не прошёл — дальше проверять остальные RCI-пути бессмысленно, пока не решена сама " +
            "авторизация. Проверьте ROUTER_HOST/ROUTER_LOGIN/ROUTER_PASSWORD в .env и повторите запуск отдельно, " +
            "не в цикле.",
        );
        process.exit(1);
    }

    await tryCall("get_system_info", () => diagnostics.getSystemInfo(transport));
    await tryCall("get_interfaces", () => diagnostics.getInterfaces(transport));
    await tryCall("list_devices", () => diagnostics.listDevices(transport));
    await tryCall("get_wan_status", () => diagnostics.getWanStatus(transport));
    await tryCall("list_wifi_clients", () => wifi.listWifiClients(transport));
    await tryCall("list_port_forwards", () => network.listPortForwards(transport));
    await tryCall("list_routes", () => network.listRoutes(transport));
    await tryCall("list_dhcp_reservations", () => network.listDhcpReservations(transport));
    await tryCall("list_vpn_interfaces", () => vpn.listVpnInterfaces(transport));
}

main().catch((error) => {
    console.error("smoke: фатальная ошибка:", error);
    process.exit(1);
});
