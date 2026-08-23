// Синхронизирует "version" из package.json (единственный источник истины) в .claude-plugin/plugin.json.
// Запускается автоматически semantic-release (см. .releaserc.json, шаг prepare / @semantic-release/exec).
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJsonPath = path.join(rootDir, "package.json");
const pluginJsonPath = path.join(rootDir, ".claude-plugin", "plugin.json");

const {version} = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const pluginJsonRaw = readFileSync(pluginJsonPath, "utf8");
const pluginJson = JSON.parse(pluginJsonRaw);
pluginJson.version = version;

writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 2) + "\n");

console.log(`plugin.json version synced to ${version}`);
