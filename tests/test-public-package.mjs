import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULTS, validateConfig } from "../config.js";
import { LifeRuntime, atomicJson } from "../runtime.js";
import { PersonMemory } from "../person-memory.js";
import { resolveOptions } from "../host.js";
import { routineAt } from "../routine.js";
import { offPeak, offPeakRemaining, HOUR } from "../schedule.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = Date.parse("2026-10-25T12:00:00+08:00"),
  key = "group:920000001",
  uid = "920000011";
function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "qq-life-public-"));
  const bridge = path.join(temp, "bridge"),
    data = path.join(temp, "home/qq-life"),
    profile = path.join(temp, "home/profiles/web");
  atomicJson(path.join(bridge, "config.json"), {
    allow: { groups: ["920000001"], private: [] },
    socialV2: { enabled: true },
  });
  fs.mkdirSync(path.join(bridge, "src"), { recursive: true });
  fs.writeFileSync(path.join(bridge, "src/bridge.js"), "// fixture");
  atomicJson(path.join(bridge, "state/mode.json"), { mode: "reserved2" });
  atomicJson(path.join(bridge, "state/current-role.json"), {
    role: "自定义群友",
    mode: "active",
  });
  atomicJson(path.join(bridge, "state/sessions.json"), {
    sessions: { [key]: "fixture-session" },
  });
  atomicJson(path.join(bridge, "state/social-v2.json"), {
    conversations: { [key]: { unread: [], recentMessages: [] } },
  });
  const pkg = {
    name: "fixture-profile",
    private: true,
    dependencies: { existing: "1.0.0" },
    dsh: { profile: { bundles: ["existing"] } },
  };
  atomicJson(path.join(profile, "package.json"), pkg);
  return {
    temp,
    bridge,
    data,
    profile,
    pkg,
    close: () => fs.rmSync(temp, { recursive: true, force: true }),
  };
}
test("public defaults require explicit proactive and paid-summary opt-in", () => {
  assert.equal(DEFAULTS.proactiveEnabled, false);
  assert.equal(DEFAULTS.proactiveGroups, "");
  assert.equal(DEFAULTS.semanticMemoryEnabled, false);
  assert.equal(DEFAULTS.leisureIntegration, false);
  assert.throws(() => validateConfig({ wakeTime: "25:00" }), /HH:mm/);
  assert.throws(
    () => validateConfig({ wakeTime: "23:00", sleepTime: "07:00" }),
    /起床时间/,
  );
  assert.equal(
    routineAt(at, { wakeTime: "13:00", sleepTime: "23:00" }).awake,
    false,
  );
  const peak = Date.parse("2026-10-26T10:30:00+08:00");
  assert.equal(offPeak(peak), false);
  assert.equal(offPeakRemaining(peak), 0);
  assert.equal(offPeak(at), true);
  assert.equal(
    offPeakRemaining(Date.parse("2026-10-26T13:30:00+08:00")),
    HOUR / 2,
  );
});
test("independent paths, custom role matching and optional leisure integration work without sibling code", () => {
  const f = fixture();
  try {
    atomicJson(path.join(f.data, "connection.json"), { bridgeRoot: f.bridge });
    assert.deepEqual(resolveOptions({ dataDir: f.data }, {}), {
      bridgeRoot: fs.realpathSync(f.bridge),
      dataDir: f.data,
    });
    assert.equal(
      resolveOptions(
        { bridgeRoot: f.bridge, dataDir: f.data },
        { QQ_BRIDGE_ROOT: "invalid" },
      ).bridgeRoot,
      fs.realpathSync(f.bridge),
    );
    const life = new LifeRuntime({
      bridgeRoot: f.bridge,
      dataDir: f.data,
      now: () => at,
    });
    assert.ok(life.inputs().active);
    life.configure({ roleName: "另一个角色" });
    assert.equal(life.inputs().active, false);
    life.configure({ roleName: "自定义群友", wakeTime: "13:00" });
    assert.equal(life.inputs().active, true);
    fs.mkdirSync(path.join(f.temp, "home/qq-leisure"), { recursive: true });
    fs.writeFileSync(
      path.join(f.temp, "home/qq-leisure/config.json"),
      "deliberately invalid sibling file",
    );
    life.sync();
    assert.equal(life.routine.wakeTime, "13:00");
    assert.throws(() => life.configure({ leisureIntegration: true }));
    assert.throws(
      () =>
        resolveOptions({
          bridgeRoot: f.bridge,
          dataDir: path.join(f.bridge, "state"),
        }),
      /重合/,
    );
  } finally {
    f.close();
  }
});
test("local facts are collected with semantic summaries off and make zero model requests", async () => {
  const f = fixture();
  let calls = 0;
  try {
    const life = new LifeRuntime({
      bridgeRoot: f.bridge,
      dataDir: f.data,
      now: () => at,
    });
    const input = life.inputs();
    life.inputs = () => input;
    let clock = at;
    const memory = new PersonMemory({
      life,
      now: () => clock,
      generate: async () => {
        calls++;
        throw Error("should not run");
      },
    });
    input.snapshots[key].recentMessages = Array.from(
      { length: 12 },
      (_, i) => ({
        userId: uid,
        messageId: String(i),
        sender: "虚构群友",
        plain: "小鲸鱼，我喜欢高达",
        time: at + i + 1,
      }),
    );
    clock += 100;
    try {
      await memory.tick();
      assert.equal(calls, 0);
      assert.ok(memory.view(uid).facts.some((f) => f.fact.includes("高达")));
    } finally {
      memory.dispose();
    }
  } finally {
    f.close();
  }
});
test("installer previews without writing, preserves profile settings, repeats safely and rejects an existing installation", () => {
  const f = fixture();
  try {
    const pkgFile = path.join(f.profile, "package.json"),
      before = fs.readFileSync(pkgFile, "utf8");
    const run = (...extra) =>
      spawnSync(
        process.execPath,
        [
          path.join(root, "scripts/install.mjs"),
          "--bridge-root",
          f.bridge,
          "--profile-dir",
          f.profile,
          ...extra,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            DSH_HOME: path.dirname(f.data),
            QQ_LIFE_DATA_DIR: f.data,
          },
        },
      );
    let r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(pkgFile, "utf8"), before);
    assert.equal(fs.existsSync(f.data), false);
    r = run("--apply");
    assert.equal(r.status, 0, r.stderr);
    const installed = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    assert.equal(installed.dependencies.existing, "1.0.0");
    assert.deepEqual(installed.dsh.profile.bundles, ["existing", "qq-life"]);
    assert.equal(
      fs.realpathSync(path.join(f.profile, "node_modules/qq-life")),
      fs.realpathSync(root),
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(f.data, "connection.json"), "utf8"))
        .bridgeRoot,
      fs.realpathSync(f.bridge),
    );
    r = run("--apply");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      JSON.parse(fs.readFileSync(pkgFile, "utf8")).dsh.profile.bundles.filter(
        (b) => b === "qq-life",
      ).length,
      1,
    );
    installed.dependencies["qq-life"] = "link:/other-plugin";
    atomicJson(pkgFile, installed);
    r = run("--apply");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /另一份/);
    assert.deepEqual(JSON.parse(fs.readFileSync(pkgFile, "utf8")), installed);
  } finally {
    f.close();
  }
});
test("DSH lifecycle registers tools and routes; only the current allowed QQ session receives the state prompt", async () => {
  const f = fixture();
  try {
    const modules = path.join(f.temp, "mock-host");
    const module = path.join(modules, "@deepseek-ai/dsh-tools/lib/index.js");
    fs.mkdirSync(path.dirname(module), { recursive: true });
    fs.writeFileSync(module, "export const defineTool = value => value;");
    atomicJson(path.join(modules, "@deepseek-ai/dsh-tools/package.json"), {
      type: "module",
    });
    const runner = path.join(f.temp, "lifecycle.mjs");
    fs.writeFileSync(
      runner,
      `
      import assert from 'node:assert/strict';
      const {apply,sameOriginRequest}=await import(${JSON.stringify(new URL("../index.js", import.meta.url).href)});
      const tools=[],routes=[],cleanup=[],hooks={};let network=0;
      globalThis.fetch=()=>{network++;throw Error('Unexpected outbound call');};
      const ctx={tools:{register:t=>tools.push(t)},webServer:{register:r=>{routes.push(r);return()=>{};}},effect:fn=>{const end=fn();if(typeof end==='function')cleanup.push(end);},on:(n,fn)=>hooks[n]=fn};
      try {
        await apply(ctx,{bridgeRoot:${JSON.stringify(f.bridge)},dataDir:${JSON.stringify(f.data)}});
        assert.deepEqual(tools.map(t=>t.name),['qq_life_state','qq_life_observe']);
        assert.equal(routes.length,2);
        const state=tools[0].execute({}, {agent:{session:{id:'fixture-session'}}}); assert.equal(state.ok,true);
        assert.equal(tools[0].execute({}, {agent:{session:{id:'other'}}}).ok,false);
        const assembled=await hooks['system-prompt/assemble']({}, {agent:{session:{id:'fixture-session'}}},async()=>({sections:[]}));
        assert.ok(assembled.sections.some(s=>s.name==='qq-life:emotion-and-relationships'));
        const other=await hooks['system-prompt/assemble']({}, {agent:{session:{id:'other'}}},async()=>({sections:[]}));assert.equal(other.sections.length,0);
        assert.equal(sameOriginRequest({method:'GET',headers:{host:'127.0.0.1:3080'}}),true);
        assert.equal(sameOriginRequest({method:'GET',headers:{host:'attacker.example'}}),false);
        assert.equal(sameOriginRequest({method:'POST',headers:{host:'127.0.0.1:3080',origin:'https://attacker.example','content-type':'application/json'}}),false);
        assert.equal(sameOriginRequest({method:'GET',headers:{host:'127.0.0.1:3080','x-agent-token':'fake'}}),false);
        await new Promise(r=>setTimeout(r,5));assert.equal(network,0);
      }finally{for(const end of cleanup.reverse())end();}
    `,
    );
    const r = spawnSync(process.execPath, [runner], {
      encoding: "utf8",
      env: { ...process.env, DSH_INSTALL_MODULES: modules },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    f.close();
  }
});
