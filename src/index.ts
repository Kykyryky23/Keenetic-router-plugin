import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {config} from "./config.js";
import {RciHttpTransport} from "./transport/rci-http.js";
import {registerTools} from "./tools/register.js";

async function main(): Promise<void> {
    const transport = new RciHttpTransport({
        host: config.routerHost,
        port: config.routerPort,
        login: config.routerLogin,
        password: config.routerPassword,
    });

    const server = new McpServer({name: "keenetic-router-plugin", version: "0.1.0"});
    registerTools(server, transport);

    const stdio = new StdioServerTransport();
    await server.connect(stdio);
    console.error(`keenetic-router-plugin: подключён к роутеру ${config.routerHost}:${config.routerPort}, слушаю stdio`);
}

main().catch((error) => {
    console.error("keenetic-router-plugin: фатальная ошибка запуска:", error);
    process.exit(1);
});
