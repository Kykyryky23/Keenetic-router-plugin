/**
 * Абстракция над способом доступа к роутеру. capabilities/* не должны знать,
 * работают ли они поверх RCI HTTP или (в будущем) SSH CLI.
 */
export interface RouterTransport {
    /** Аналог GET /rci/show/<path> — только чтение состояния роутера. */
    show(path: string): Promise<unknown>;

    /**
     * Отправляет "дерево команд" на роутер — POST /rci с JSON-телом, ветки
     * которого зеркалят иерархию CLI-команды (стандартный механизм RCI:
     * `interface X authentication wpa-psk foo` <=> {"interface":{"X":{"authentication":{"wpa-psk":"foo"}}}}).
     * Отмена команды выражается обёрткой {"no": {...}}.
     */
    exec(commandTree: Record<string, unknown>): Promise<unknown>;
}

export class RouterTransportError extends Error {
    constructor(
        message: string,
        readonly cause?: unknown,
    ) {
        super(message);
        this.name = "RouterTransportError";
    }
}
