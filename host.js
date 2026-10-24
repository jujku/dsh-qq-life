import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Host packages belong to DSH. They are not copied into the release archive.
export async function importHost(name) {
  if (!["@deepseek-ai/dsh-tools", "@deepseek-ai/dsh-llm"].includes(name))
    throw new Error("Unknown host module");
  const modules = process.env.DSH_INSTALL_MODULES;
  if (modules)
    return import(pathToFileURL(path.join(modules, name, "lib/index.js")).href);
  try {
    return await import(name);
  } catch (error) {
    throw new Error(
      `缺少 DSH 宿主模块 ${name}；请从已安装的 DSH 加载此插件。`,
      { cause: error },
    );
  }
}

export function resolveOptions(options = {}, env = process.env) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw Error("插件选项必须为对象");
  const dataDir = path.resolve(
    options.dataDir ||
      env.QQ_LIFE_DATA_DIR ||
      path.join(env.DSH_HOME || path.join(os.homedir(), ".dsh"), "qq-life"),
  );
  let connection = {};
  try {
    connection = JSON.parse(
      fs.readFileSync(path.join(dataDir, "connection.json"), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const embedded = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const detected =
    fs.existsSync(path.join(embedded, "config.json")) &&
    fs.existsSync(path.join(embedded, "src/bridge.js"))
      ? embedded
      : null;
  const candidate =
    options.bridgeRoot ||
    env.QQ_BRIDGE_ROOT ||
    connection.bridgeRoot ||
    detected;
  if (
    !candidate ||
    typeof candidate !== "string" ||
    !path.isAbsolute(candidate)
  )
    throw Error(
      "请设置 QQ_BRIDGE_ROOT，或先运行 scripts/install.mjs 指定 qq-bridge 的绝对路径。",
    );
  const bridgeRoot = fs.realpathSync(candidate);
  const cfg = JSON.parse(
    fs.readFileSync(path.join(bridgeRoot, "config.json"), "utf8"),
  );
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg) || !cfg.allow)
    throw Error("目标不是有效的 qq-bridge 配置目录");
  if (dataDir === bridgeRoot || dataDir === path.join(bridgeRoot, "state"))
    throw Error("插件数据目录不能与桥接目录或其 state 目录重合");
  return { bridgeRoot, dataDir };
}
