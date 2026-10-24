import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULTS, validateConfig } from "../config.js";
import {
  HOUR,
  DAY,
  newState,
  migrateState,
  advance,
  ingest,
  observe,
  viewFor,
  proactivePlan as baseProactivePlan,
  classify,
  safeFact,
  renderPrompt,
} from "../engine.js";
import { LifeRuntime, atomicJson } from "../runtime.js";
const proactivePlan = (
  s,
  k,
  snap,
  at,
  cfg = { ...DEFAULTS, proactiveEnabled: true, proactiveGroups: "920000001" },
) => baseProactivePlan(s, k, snap, at, cfg);
const t0 = Date.UTC(2026, 9, 22, 4); // 12:00 Hong Kong
const key = "group:920000001",
  other = "group:920000002",
  uid = "920000011";
function msg(text, n = 1, at = t0 + 1000, opts = {}) {
  return {
    messageId: String(n),
    seq: n,
    userId: uid,
    sender: "测试群友",
    plain: text,
    time: at,
    isSelf: false,
    ...opts,
  };
}
const snap = (messages) => ({
  [key]: { recentMessages: messages, unread: [] },
});

test("time decay is gradual, tick-independent, bounded and recovers from anger", () => {
  const a = newState(t0),
    b = newState(t0);
  advance(a, t0 + 5 * HOUR);
  for (let i = 1; i <= 300; i++) advance(b, t0 + i * 60000);
  assert.ok(Math.abs(a.mood - b.mood) < 1e-7);
  assert.ok(Math.abs(a.boredom - b.boredom) < 1e-7);
  assert.ok(a.mood > 59 && a.mood < 60);
  assert.equal(a.boredom, 75);
  advance(a, t0 + 50 * DAY);
  assert.ok(Math.abs(a.mood - DEFAULTS.moodFloor) < 1e-7);
  assert.ok(a.boredom >= 0 && a.boredom <= 100);
  a.mood = 0;
  advance(a, t0 + 50 * DAY + HOUR);
  assert.ok(a.mood > 0 && a.mood < 6);
});
test("real conversation builds affinity, reduces boredom, deduplicates and survives seq reset", () => {
  const s = newState(t0);
  s.boredom = 80;
  const first = msg("小鲸鱼，最近怎么样");
  ingest(s, snap([first]), first.time);
  assert.equal(
    s.members[uid].affinity,
    18,
    "unanswered incoming messages cannot farm a relationship",
  );
  assert.ok(s.boredom < 70);
  ingest(
    s,
    snap([first, { isSelf: true, time: first.time + 1, messageId: "reply-1" }]),
    first.time + 1,
  );
  const firstScore = s.members[uid].affinity;
  assert.ok(firstScore > 18 && firstScore < 18.2);
  const before = structuredClone(s);
  ingest(s, snap([first]), first.time);
  assert.deepEqual(s, before);
  const duplicate = { ...first, time: t0 + 10000 };
  ingest(s, snap([duplicate]), duplicate.time);
  assert.equal(s.members[uid].affinity, firstScore);
  const newer = msg("小鲸鱼，来聊聊", 1, t0 + 10 * 60000, {
    messageId: "reset-2",
  });
  ingest(
    s,
    snap([newer, { isSelf: true, time: newer.time + 1, messageId: "reply-2" }]),
    newer.time + 1,
  );
  assert.ok(s.members[uid].affinity > firstScore);
});
test("legacy receipt migration preserves affinity and prevents replay after restart", () => {
  const s = newState(t0);
  const m = msg("小鲸鱼，你好");
  ingest(s, snap([m]), m.time);
  s.version = 1;
  s.observations = {
    [key + ":" + m.messageId + ":" + m.time]: Object.values(s.observations)[0],
  };
  const affinity = s.members[uid].affinity;
  migrateState(s);
  assert.equal(s.version, 2);
  ingest(s, snap([m]), m.time);
  assert.equal(s.members[uid].affinity, affinity);
});
test("spam cannot instantly max affinity and normal spaced messages continue earning", () => {
  const s = newState(t0);
  const messages = Array.from({ length: 100 }, (_, i) =>
    msg("小鲸鱼，你好棒 " + i, i + 1, t0 + 1000 + i * 100),
  );
  ingest(s, snap(messages), messages.at(-1).time);
  assert.ok(s.members[uid].affinity < 22);
  const more = Array.from({ length: 30 }, (_, i) =>
    msg("小鲸鱼，继续聊", i + 200, t0 + (i + 1) * 10 * 60000),
  );
  ingest(s, snap(more), more.at(-1).time);
  assert.equal(
    s.members[uid].affinity,
    18,
    "unanswered spam and spaced mentions remain uncredited",
  );
  ingest(
    s,
    snap([
      more.at(-1),
      { isSelf: true, time: more.at(-1).time + 1, messageId: "real-reply" },
    ]),
    more.at(-1).time + 1,
  );
  assert.ok(s.members[uid].affinity > 18 && s.members[uid].affinity <= 26);
});
test("repeated directed insults anger the bot, apologies soothe it, third-party insults do not", () => {
  const s = newState(t0);
  const messages = [
    msg("小鲸鱼，你是个废物", 1),
    msg("小鲸鱼，闭嘴", 2, t0 + 2000),
    msg("小鲸鱼，傻逼", 3, t0 + 3000),
  ];
  ingest(s, snap(messages), t0 + 3000);
  assert.ok(s.members[uid].anger > 59);
  assert.equal(
    s.members[uid].affinity,
    18,
    "short-term anger reacts, durable affinity waits for confirmed interaction",
  );
  const apology = msg("小鲸鱼，对不起，刚才说重了", 4, t0 + 4000);
  ingest(s, snap([apology]), apology.time);
  assert.ok(s.members[uid].anger < 36);
  advance(s, t0 + 5 * HOUR);
  assert.equal(s.members[uid].anger, 0);
  const separate = newState(t0);
  ingest(separate, snap([msg("这游戏策划真傻逼")]), t0 + 1000);
  assert.equal(separate.members[uid].anger, 0);
  assert.equal(classify("小鲸鱼，这游戏策划真傻逼"), "neutral");
  assert.equal(classify("小鲸鱼，开玩笑逗你的"), "playful");
});
test("semantic correction needs true evidence, is bounded and only applied once", () => {
  const s = newState(t0);
  const m = msg("小鲸鱼，这句话只是个玩笑，傻逼");
  ingest(s, snap([m]), m.time);
  assert.throws(
    () =>
      observe(
        s,
        key,
        m,
        { kind: "praise", evidence: "你真厉害", directed: true },
        m.time,
      ),
    /证据/,
  );
  observe(
    s,
    key,
    m,
    { kind: "playful", evidence: "只是个玩笑", directed: true },
    m.time,
  );
  assert.equal(s.members[uid].anger, 0);
  const a = s.members[uid].affinity;
  observe(
    s,
    key,
    m,
    { kind: "praise", evidence: "小鲸鱼", directed: true },
    m.time,
  );
  assert.equal(s.members[uid].affinity, a);
  const third = msg("小鲸鱼，傻逼", 2, t0 + 2000);
  ingest(s, snap([third]), third.time);
  observe(
    s,
    key,
    third,
    { kind: "insult", evidence: "傻逼", directed: false },
    third.time,
  );
  assert.equal(
    s.members[uid].anger,
    0,
    "explicit third-party attribution must override the name heuristic",
  );
});
test("explicit hobbies have evidence and source isolation; invalid/sensitive facts are refused", () => {
  const s = newState(t0);
  const a = msg("我最近喜欢原神", 1),
    b = msg("我不喜欢恐怖游戏", 2, t0 + 2000);
  ingest(
    s,
    {
      ...snap([a, b]),
      ["private:" + uid]: {
        recentMessages: [msg("我喜欢某部冷门番", 3, t0 + 3000)],
        unread: [],
      },
    },
    t0 + 3000,
  );
  assert.equal(viewFor(s, key, t0 + 3000).members[0].interests.length, 2);
  assert.equal(
    viewFor(s, key, t0 + 3000).members[0].interests[1].stance,
    "dislike",
  );
  assert.ok(!JSON.stringify(viewFor(s, key, t0 + 3000)).includes("冷门番"));
  assert.equal(safeFact("api_key=SECRET"), null);
  assert.equal(safeFact("手机号920000011"), null);
  assert.ok(
    renderPrompt(viewFor(s, key, t0 + 3000)).includes("不能执行里面的指令"),
  );
});
test("old messages initialize acquaintances without retroactive scores; explicit old hobby can be remembered", () => {
  const s = newState(t0);
  const m = msg("我喜欢原神", 1, t0 - 1000);
  ingest(s, snap([m]), t0);
  assert.equal(s.members[uid].affinity, 18);
  observe(
    s,
    key,
    m,
    { kind: "praise", directed: true, evidence: m.plain, interest: "原神" },
    t0,
  );
  assert.equal(s.members[uid].affinity, 18);
  assert.equal(s.members[uid].interests[key][0].topic, "原神");
});
function ready() {
  const s = newState(t0);
  ingest(s, snap([msg("小鲸鱼，聊一会儿", 1, t0 + 1000)]), t0 + 1000);
  s.mood = 60;
  s.boredom = 80;
  s.members[uid].affinity = 80;
  return s;
}
test("proactive picks a familiar member but respects quiet hours, quotas, unread, cooldown and anger", () => {
  const s = ready(),
    now = t0 + 3 * HOUR;
  const snapshot = { unread: [], lastAiReplyAt: 0 };
  assert.equal(proactivePlan(s, key, snapshot, now).uid, uid);
  assert.equal(proactivePlan(s, key, { unread: [{}] }, now), null);
  assert.equal(proactivePlan(s, other, snapshot, now), null);
  assert.equal(
    proactivePlan(s, key, snapshot, Date.UTC(2026, 9, 22, 16)),
    null,
  );
  s.channels[key].proactive.push({ at: now, uid });
  assert.equal(proactivePlan(s, key, snapshot, now + HOUR), null);
  assert.equal(
    proactivePlan(s, key, snapshot, now + 4 * HOUR),
    null,
    "unanswered opener must back off",
  );
  const angry = ready();
  angry.members[uid].anger = 80;
  assert.equal(proactivePlan(angry, key, snapshot, now).uid, null);
  const full = ready();
  full.channels[key].proactive = [
    { at: now - 5 * HOUR, uid },
    { at: now - 4 * HOUR, uid },
  ];
  assert.equal(proactivePlan(full, key, snapshot, now), null);
});
function fixture(fetcher) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "qq-life-test-"));
  const root = path.join(temp, "bridge"),
    dir = path.join(temp, "data");
  let now = t0;
  atomicJson(path.join(root, "config.json"), {
    consoleToken: "fixture-only",
    allow: { groups: ["920000001", "920000002"], private: [uid] },
    socialV2: { enabled: true },
  });
  atomicJson(path.join(root, "state/mode.json"), { mode: "reserved2" });
  atomicJson(path.join(root, "state/current-role.json"), {
    role: "小鲸鱼",
    mode: "active",
  });
  atomicJson(path.join(root, "state/sessions.json"), {
    sessions: { [key]: "session-test", [other]: "other-session" },
  });
  atomicJson(path.join(root, "state/social-v2.json"), {
    paused: false,
    conversations: snap([]),
  });
  atomicJson(path.join(dir, "config.json"), {
    proactiveEnabled: true,
    proactiveGroups: "920000001",
    leisureIntegration: true,
  });
  const options = {
    bridgeRoot: root,
    dataDir: dir,
    now: () => now,
    fetcher,
    logger: () => {},
  };
  return {
    temp,
    root,
    dir,
    options,
    runtime: new LifeRuntime(options),
    setNow: (t) => (now = t),
    close: () => fs.rmSync(temp, { recursive: true, force: true }),
  };
}
test("runtime persists across restart, validates scope, configuration and corrupted storage", () => {
  const f = fixture();
  try {
    f.setNow(t0 + 1000);
    atomicJson(path.join(f.root, "state/social-v2.json"), {
      conversations: snap([msg("小鲸鱼，你好")]),
    });
    f.runtime.sync();
    const expected = f.runtime.state.members[uid].affinity;
    const next = new LifeRuntime(f.options);
    next.sync();
    assert.equal(next.state.members[uid].affinity, expected);
    assert.equal(next.scoped("session-test").key, key);
    assert.throws(() => next.scoped("unknown"), /当前/);
    assert.throws(
      () =>
        next.annotate("other-session", {
          messageId: "1",
          kind: "praise",
          evidence: "你好",
        }),
      /当前/,
    );
    assert.throws(() => next.configure({ maxPerDay: 100 }), /范围/);
    assert.throws(() => validateConfig({ garbage: 1 }), /未知/);
    fs.writeFileSync(path.join(f.dir, "state.json"), "bad json");
    assert.throws(() => new LifeRuntime(f.options));
    assert.equal(
      fs.readFileSync(path.join(f.dir, "state.json"), "utf8"),
      "bad json",
    );
  } finally {
    f.close();
  }
});
test("scheduler uses existing bridge gates and reserves persistent quota before a timeout", async () => {
  const calls = [];
  let f;
  let fail = false;
  f = fixture(async (url, init) => {
    calls.push({ url, body: init.body && JSON.parse(init.body) });
    if (url.endsWith("/api/status"))
      return {
        ok: true,
        json: async () => ({
          mode: "reserved2",
          role: "小鲸鱼",
          roleMode: "active",
          dshReady: true,
          snowluma: { connected: true, accountOnline: true },
        }),
      };
    assert.equal(
      f.runtime.state.channels[key].proactive.at(-1).status,
      "reserved",
    );
    if (fail) throw Error("timeout");
    return { ok: true, json: async () => ({ ok: true }) };
  });
  try {
    f.setNow(t0 + 1000);
    atomicJson(path.join(f.root, "state/social-v2.json"), {
      conversations: snap([msg("小鲸鱼，你好")]),
    });
    f.runtime.sync();
    f.runtime.state.members[uid].affinity = 80;
    f.setNow(t0 + 5 * HOUR);
    await f.runtime.tick();
    assert.equal(calls.filter((c) => c.body).length, 1);
    assert.equal(calls.at(-1).body.key, key);
    assert.ok(calls.at(-1).body.note.includes("禁止全体@"));
    await f.runtime.tick();
    assert.equal(calls.filter((c) => c.body).length, 1);
    // Make a new human interaction after the first opening, then a later safe opportunity.
    f.setNow(t0 + 6 * HOUR);
    atomicJson(path.join(f.root, "state/social-v2.json"), {
      conversations: snap([msg("小鲸鱼，聊过了", 2, t0 + 6 * HOUR)]),
    });
    f.runtime.sync();
    f.setNow(t0 + 10 * HOUR);
    fail = true;
    await f.runtime.tick();
    assert.equal(
      f.runtime.state.channels[key].proactive.at(-1).status,
      "uncertain-or-rejected",
    );
    const next = new LifeRuntime(f.options);
    await next.tick();
    assert.equal(calls.filter((c) => c.body).length, 2);
  } finally {
    f.close();
  }
});
test("disabled mode stops updates/scheduling, removed whitelist stops scoped reads", async () => {
  const f = fixture(() => {
    throw Error("must not call network");
  });
  try {
    f.runtime.configure({ enabled: false });
    f.setNow(t0 + HOUR);
    atomicJson(path.join(f.root, "state/social-v2.json"), {
      conversations: snap([msg("小鲸鱼，傻逼", 1, t0 + HOUR - 1000)]),
    });
    await f.runtime.tick();
    f.runtime.configure({ enabled: true });
    assert.equal(Object.keys(f.runtime.state.members).length, 1);
    assert.equal(f.runtime.state.members[uid].anger, 0);
    atomicJson(path.join(f.root, "config.json"), {
      allow: { groups: [], private: [] },
    });
    assert.throws(() => f.runtime.scoped("session-test"), /当前/);
  } finally {
    f.close();
  }
});

test("completed study relieves boredom exactly once across a restart", () => {
  const f = fixture();
  try {
    f.runtime.state.mood = 65;
    f.runtime.state.boredom = 50;
    atomicJson(path.join(path.dirname(f.dir), "qq-leisure/state.json"), {
      jobs: [{ id: "real-study", kind: "study", status: "completed", at: t0 }],
    });
    f.runtime.sync();
    assert.ok(f.runtime.state.mood > 65 && f.runtime.state.mood < 66);
    assert.equal(f.runtime.state.boredom, 42);
    f.runtime.sync();
    assert.equal(f.runtime.state.boredom, 42);
    const next = new LifeRuntime(f.options);
    next.sync();
    assert.equal(next.state.boredom, 42);
  } finally {
    f.close();
  }
});

test("active reading suppresses bored proactive opening and resumes after focus", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        mode: "reserved2",
        role: "小鲸鱼",
        roleMode: "active",
        dshReady: true,
        snowluma: { connected: true, accountOnline: true },
      }),
    };
  });
  try {
    f.setNow(t0 + 1000);
    atomicJson(path.join(f.root, "state/social-v2.json"), {
      conversations: snap([msg("小鲸鱼，你好")]),
    });
    f.runtime.sync();
    f.runtime.state.members[uid].affinity = 80;
    f.setNow(t0 + 5 * HOUR);
    atomicJson(path.join(path.dirname(f.dir), "qq-leisure/state.json"), {
      focus: { until: t0 + 6 * HOUR },
    });
    await f.runtime.tick();
    assert.equal(calls, 0);
    atomicJson(path.join(path.dirname(f.dir), "qq-leisure/state.json"), {
      focus: null,
    });
    await f.runtime.tick();
    assert.equal(calls, 2);
  } finally {
    f.close();
  }
});

test("private chat never changes mood/boredom or resets group loneliness clock, including semantic correction", () => {
  const s = newState(t0);
  const privateKey = "private:" + uid;
  const texts = [
    "小鲸鱼，你好棒",
    "小鲸鱼，傻逼",
    "小鲸鱼，对不起",
    "小鲸鱼，来聊聊",
  ];
  for (let i = 0; i < texts.length; i++) {
    const at = t0 + (i + 1) * 10 * 60000,
      m = msg(texts[i], i + 1, at);
    const expected = structuredClone(s);
    advance(expected, at);
    ingest(s, { [privateKey]: { recentMessages: [m] } }, at);
    assert.equal(s.mood, expected.mood);
    assert.equal(s.boredom, expected.boredom);
    assert.equal(s.lastContactAt, t0);
    observe(
      s,
      privateKey,
      m,
      {
        kind: i === 1 ? "playful" : "friendly",
        directed: true,
        evidence: texts[i],
      },
      at,
    );
    assert.equal(s.mood, expected.mood);
    assert.equal(s.boredom, expected.boredom);
    assert.equal(s.lastContactAt, t0);
    ingest(
      s,
      {
        [privateKey]: {
          recentMessages: [
            m,
            { isSelf: true, time: at + 1, messageId: "private-reply-" + i },
          ],
        },
      },
      at + 1,
    );
  }
  assert.notEqual(
    s.members[uid].affinity,
    18,
    "private relationships still develop",
  );
});

test("private credit timers do not suppress a following real group mood event", () => {
  const a = newState(t0),
    b = newState(t0);
  const at = t0 + 1000;
  ingest(
    a,
    { ["private:" + uid]: { recentMessages: [msg("你好棒", 1, at)] } },
    at,
  );
  const group = msg("小鲸鱼，你好棒", 2, at + 1000);
  ingest(a, snap([group]), at + 1000);
  ingest(b, snap([group]), at + 1000);
  assert.ok(Math.abs(a.mood - b.mood) < 1e-9);
  assert.ok(Math.abs(a.boredom - b.boredom) < 1e-9);
  assert.equal(a.lastContactAt, group.time);
});

test("legacy migration preserves scores while removing private contact from the loneliness clock", () => {
  const s = newState(t0);
  delete s.emotionPolicy;
  s.mood = 72;
  s.boredom = 36;
  s.lastContactAt = t0 + 2 * HOUR;
  s.observations = {
    g: {
      key,
      uid,
      directed: true,
      at: t0 + HOUR,
      kind: "neutral",
      effect: { boredom: -12 },
    },
    p: {
      key: "private:" + uid,
      uid,
      directed: true,
      at: t0 + 2 * HOUR,
      kind: "praise",
      effect: { mood: 5 },
    },
  };
  migrateState(s);
  assert.equal(s.mood, 72);
  assert.equal(s.boredom, 36);
  assert.equal(s.lastContactAt, t0 + HOUR);
  assert.equal(s.emotionPolicy, "group-only-v1");
});
