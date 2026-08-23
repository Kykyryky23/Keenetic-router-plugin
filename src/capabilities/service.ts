import {RouterTransport} from "../transport/types.js";

/**
 * Destructive-операции. Только reboot реализован.
 *
 * ВАЖНО: форма {reboot: {}} НЕ проверена вживую на реальном роутере в рамках этого проекта —
 * это широко используемый в сторонних интеграциях Keenetic вызов, но не подтверждённый факт для
 * этого конкретного устройства/прошивки (в отличие от всех остальных RCI-форм в capabilities/*,
 * которые явно помечены "подтверждено"/"не проверено" по факту реальной проверки). Риск ошибки
 * здесь ниже, чем у factory-reset/firmware-update (неверный payload для reboot максимум не
 * перезагрузит роутер или вернёт ошибку, а не испортит прошивку), но полагаться на "должно
 * сработать" не стоит — сверь с dryRun и явным подтверждением перед первым реальным использованием.
 *
 * factory-reset и firmware-update сознательно оставлены заглушками: неверно угаданное RCI-дерево
 * для них может испортить конфигурацию или прошивку роутера, а не просто вернуть ошибку — их
 * стоит реализовывать только после проверки точного формата на реальном устройстве.
 */

export function buildRebootPayload(): Record<string, unknown> {
    return {reboot: {}};
}

export function reboot(transport: RouterTransport) {
    return transport.exec(buildRebootPayload());
}

export function factoryReset(_transport: RouterTransport): Promise<never> {
    return Promise.reject(
        new Error("factoryReset не реализован — требует проверки точного RCI-дерева на реальном роутере перед реализацией."),
    );
}

export function firmwareUpdate(_transport: RouterTransport, _args: unknown): Promise<never> {
    return Promise.reject(
        new Error("firmwareUpdate не реализован — требует проверки точного RCI-дерева на реальном роутере перед реализацией."),
    );
}
