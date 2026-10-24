#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fs.realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
);
const args = process.argv.slice(2),
  opts = {};
try {
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--apply" || flag === "--help") opts[flag] = true;
    else if (
      ["--bridge-root", "--profile-dir", "--data-dir"].includes(flag) &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      opts[flag] = args[++i];
    else throw Error("未知参数或缺少参数值：" + flag);
  }
  if (opts["--help"]) {
    console.log(
      "node scripts/install.mjs --bridge-root <绝对路径> [--profile-dir <DSH profile目录>] [--data-dir <插件数据目录>] [--apply]\n默认只预览；--apply 才写入。请先停止 DSH。",
    );
    process.exit(0);
  }
  if (!opts["--bridge-root"] || !path.isAbsolute(opts["--bridge-root"]))
    throw Error("--bridge-root 必须是 qq-bridge 的绝对路径");
  const bridgeRoot = fs.realpathSync(opts["--bridge-root"]);
  const cfg = JSON.parse(
    fs.readFileSync(path.join(bridgeRoot, "config.json"), "utf8"),
  );
  if (!cfg?.allow || !fs.existsSync(path.join(bridgeRoot, "src/bridge.js")))
    throw Error("未找到有效 qq-bridge 安装");
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  const profile = path.resolve(
    opts["--profile-dir"] || path.join(home, "profiles/web"),
  );
  const dataDir = path.resolve(
    opts["--data-dir"] ||
      process.env.QQ_LIFE_DATA_DIR ||
      path.join(home, "qq-life"),
  );
  if (dataDir === bridgeRoot || dataDir === path.join(bridgeRoot, "state"))
    throw Error("数据目录不能覆盖桥接目录");
  // A custom data directory needs the same environment variable on every DSH start.
  if (
    opts["--data-dir"] &&
    path.resolve(process.env.QQ_LIFE_DATA_DIR || path.join(home, "qq-life")) !==
      dataDir
  )
    throw Error(
      "自定义数据目录前，请先设置 QQ_LIFE_DATA_DIR，DSH 启动时也要保留此变量",
    );
  const pkgFile = path.join(profile, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  const dep = "link:" + root.replaceAll("\\", "/");
  if (pkg.dependencies?.["qq-life"] && pkg.dependencies["qq-life"] !== dep)
    throw Error(
      "该 profile 已安装另一份 qq-life；先备份并移除旧 bundle，避免两个实例同时写档",
    );
  const bundles = pkg.dsh?.profile?.bundles || [];
  if (!Array.isArray(bundles)) throw Error("dsh.profile.bundles 必须是数组");
  const link = path.join(profile, "node_modules/qq-life");
  let existing;
  try {
    existing = fs.lstatSync(link);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (
    existing &&
    (!existing.isSymbolicLink() || fs.realpathSync(link) !== root)
  )
    throw Error("node_modules/qq-life 已存在且不指向本插件，请先处理旧安装");
  const connection = path.join(dataDir, "connection.json");
  if (
    fs.existsSync(connection) &&
    JSON.parse(fs.readFileSync(connection, "utf8")).bridgeRoot !== bridgeRoot
  )
    throw Error("已有连接设置指向其他桥接；请先备份并明确更新 connection.json");
  pkg.dependencies = { ...pkg.dependencies, "qq-life": dep };
  pkg.dsh = {
    ...pkg.dsh,
    profile: {
      ...pkg.dsh?.profile,
      bundles: [...new Set([...bundles, "qq-life"])],
    },
  };
  console.log(
    JSON.stringify(
      {
        apply: !!opts["--apply"],
        plugin: root,
        profile,
        bridgeRoot,
        dataDir,
        action: "注册 bundle 和本地链接；不修改桥接配置，不复制凭据",
      },
      null,
      2,
    ),
  );
  if (!opts["--apply"]) {
    console.log(
      "预览完成；确认路径正确并停止 DSH 后，使用同样参数加 --apply。",
    );
    process.exit(0);
  }
  const backup =
    pkgFile + ".backup-" + new Date().toISOString().replaceAll(/[:.]/g, "-");
  fs.copyFileSync(pkgFile, backup);
  let createdLink = false,
    createdConnection = false;
  try {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    if (!existing) {
      fs.symlinkSync(
        root,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
      createdLink = true;
    }
    if (!fs.existsSync(connection)) {
      fs.writeFileSync(
        connection,
        JSON.stringify({ bridgeRoot }, null, 2) + "\n",
        { mode: 0o600, flag: "wx" },
      );
      createdConnection = true;
    }
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  } catch (e) {
    fs.copyFileSync(backup, pkgFile);
    if (createdLink) fs.unlinkSync(link);
    if (createdConnection) fs.unlinkSync(connection);
    throw e;
  }
  console.log(
    "安装完成。重启 DSH，在设置中打开“QQ Life 状态”。profile 备份：" + backup,
  );
} catch (error) {
  console.error("安装未完成：" + error.message);
  process.exitCode = 1;
}
