import {RouterTransport} from "../transport/types.js";

/**
 * Policy-routing по доменным именам (не по IP): object-group fqdn + dns-proxy route.
 * ПОДТВЕРЖДЕНО ВЖИВУЮ — перехвачено через XHR-патч на
 * реальном веб-интерфейсе роутера при создании списка:
 * - `include` — массив объектов `{address: "..."}`, НЕ голые строки (голые строки дают
 *   "no input" для каждого домена — та же природа ошибки, что у Wi-Fi WPA-PSK).
 * - Перед установкой нового `include` веб-интерфейс сначала шлёт `{include: {no: true}}`
 *   (очистка старого списка) отдельной командой — но это не обязательно: раздел 3 skill'а уже
 *   подтвердил на `ip route`, что router применяет write как полную замену, а не merge, так что
 *   отправка нового `include`-массива без предварительного clear тоже должна заменить список
 *   целиком (не проверялось отдельно, но веб-интерфейс всегда шлёт оба шага вместе).
 * - `dns-proxy route` — НЕ массив и НЕ ключ `"object-group"`: единственный объект под `route` с
 *   полями `group` (не `object-group`!), `gateway` (пустая строка, если не используется),
 *   `auto`, `reject: false`, `interface`.
 */
export interface DomainRouteArgs {
    /** Имя object-group, например "domain-list3". Должно быть уникальным на роутере. */
    name: string;
    description: string;
    domains: string[];
    /** Имя интерфейса, куда направлять трафик по этим доменам (обычно VPN). */
    target: string;
}

export function buildAddDomainRoutePayload(args: DomainRouteArgs): Record<string, unknown> {
    return {
        "object-group": {
            fqdn: {
                [args.name]: {
                    description: args.description,
                    include: args.domains.map((address) => ({address})),
                },
            },
        },
        "dns-proxy": {
            route: {group: args.name, gateway: "", auto: true, reject: false, interface: args.target},
        },
    };
}

export function addDomainRoute(transport: RouterTransport, args: DomainRouteArgs) {
    return transport.exec(buildAddDomainRoutePayload(args));
}
