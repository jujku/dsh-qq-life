import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  newState,
  ingest,
  observe,
  migrateState,
  viewFor,
  speakerFocus,
  proactivePlan,
} from "../engine.js";
import { DEFAULTS } from "../config.js";
import { relationshipView, rebaseRelationship } from "../relationships.js";
import { PersonMemory, personalFacts } from "../person-memory.js";
const at = Date.parse("2026-10-24T19:30:00+08:00"),
  M = 60000,
  D = 86400000,
  key = "group:920000001",
  other = "group:920000002",
  uid = "920000011";
function conversation(s, time, n, text = "小鲸鱼，聊游戏" + n, kind, k = key) {
  const m = {
    userId: uid,
    sender: "虚构群友",
    messageId: "human-" + n,
    time,
    seq: n * 2,
    plain: text,
  };
  const own = {
    isSelf: true,
    time: time + 1000,
    messageId: "self-" + n,
    plain: "已回应",
    seq: n * 2 + 1,
  };
  ingest(s, { [k]: { recentMessages: [m, own] } }, time + 1000);
  if (kind)
    observe(s, k, m, { kind, directed: true, evidence: text }, time + 1000);
  return { m, own };
}
test("migration preserves legacy affection and does not retrospectively manufacture familiarity/trust", () => {
  const s = newState(at - D);
  delete s.relationshipStartedAt;
  s.members[uid] = {
    affinity: 73,
    anger: 0,
    fluster: 0,
    interests: {},
    lastSeenAt: at - D,
  };
  migrateState(s, at);
  conversation(s, at - M, 1);
  assert.equal(s.members[uid].affinity, 73);
  assert.equal(relationshipView(s.members[uid], at, key).familiarity, null);
});
test("an incoming message alone earns nothing; successful response creates one bounded encounter, replay is idempotent", () => {
  const s = newState(at),
    m = {
      userId: uid,
      sender: "甲",
      messageId: "x",
      time: at + 1,
      plain: "小鲸鱼，聊聊",
    };
  ingest(s, { [key]: { recentMessages: [m] } }, at + 2);
  assert.equal(s.members[uid].affinity, 18);
  assert.equal(s.members[uid].relation.effectiveEpisodes, 0);
  const snap = {
    [key]: {
      recentMessages: [m, { isSelf: true, time: at + 3, messageId: "own" }],
    },
  };
  ingest(s, snap, at + 3);
  const first = s.members[uid].affinity;
  assert.ok(first > 18 && first < 18.2);
  assert.equal(s.members[uid].relation.effectiveEpisodes, 1);
  ingest(s, snap, at + 3);
  assert.equal(s.members[uid].affinity, first);
});
test("continuous messages merge; copy-paste praise across groups cannot farm affection", () => {
  const s = newState(at);
  conversation(s, at + M, 1, "小鲸鱼，你好棒", "praise");
  const first = s.members[uid].affinity;
  for (let i = 2; i < 7; i++)
    conversation(s, at + i * M, i, "小鲸鱼，你好棒", "praise");
  conversation(s, at + 11 * M, 11, "小鲸鱼，你好棒", "praise", other);
  assert.equal(s.members[uid].affinity, first);
  assert.equal(s.members[uid].relation.effectiveEpisodes, 1);
});
test("ordinary chatter mostly builds familiarity; higher affection grows slower; daily budgets hold", () => {
  const low = newState(at),
    high = newState(at);
  conversation(low, at + M, 1);
  conversation(high, at + M, 1);
  high.members[uid].affinity = 90;
  rebaseRelationship(high.members[uid], at + 2 * M);
  const a = low.members[uid].affinity,
    b = high.members[uid].affinity;
  for (let i = 2; i < 55; i++) {
    conversation(
      low,
      at + i * 10 * M,
      i,
      "小鲸鱼，谢谢你，话题" + i,
      "friendly",
    );
    conversation(
      high,
      at + i * 10 * M,
      i,
      "小鲸鱼，谢谢你，话题" + i,
      "friendly",
    );
  }
  assert.ok(low.members[uid].affinity - a > high.members[uid].affinity - b);
  assert.ok(low.members[uid].affinity <= 18 + 8 * 2);
  assert.ok(low.members[uid].relation.familiarity <= 12 + 1e-8);
  assert.ok(low.members[uid].relation.trust <= 52);
});
test("insults can reduce long-term trust; apology calms anger without resetting trust; no personal anger transfer", () => {
  const s = newState(at);
  for (let i = 1; i <= 4; i++)
    conversation(s, at + i * 10 * M, i, "小鲸鱼，你是个废物" + i, "insult");
  const trust = s.members[uid].relation.trust;
  assert.equal(trust, 34);
  const anger = s.members[uid].anger;
  conversation(s, at + 50 * M, 5, "小鲸鱼，对不起", "apology");
  assert.equal(s.members[uid].relation.trust, trust);
  assert.ok(s.members[uid].anger < anger);
  assert.equal(viewFor(s, other, at + 51 * M).members.length, 0);
});
test("heuristic insult does not penalize durable relationship without semantic confirmation; corrections retain evidence", () => {
  const s = newState(at),
    { m } = conversation(s, at + M, 1, "小鲸鱼，废物只是个称呼");
  const before = s.members[uid].affinity;
  observe(
    s,
    key,
    m,
    { kind: "playful", directed: true, evidence: "废物只是个称呼" },
    at + 2 * M,
  );
  assert.ok(s.members[uid].affinity >= before);
  assert.equal(s.members[uid].relation.trust, 50.1);
  const score = s.members[uid].affinity;
  s.observations = {};
  ingest(s, {}, at + 3 * M);
  assert.equal(s.members[uid].affinity, score);
});
test("ambiguous group reply does not give all senders credit; unrelated numbers never become targets", () => {
  const s = newState(at),
    rows = [
      {
        userId: uid,
        messageId: "a",
        time: at + 1,
        plain: "小鲸鱼你好 920000088",
      },
      {
        userId: "920000012",
        messageId: "b",
        time: at + 2,
        plain: "小鲸鱼你好",
      },
      { isSelf: true, messageId: "reply", time: at + 3 },
    ];
  ingest(s, { [key]: { recentMessages: rows } }, at + 3);
  assert.equal(s.members[uid].relation.effectiveEpisodes, 0);
  assert.equal(s.members["920000012"].relation.effectiveEpisodes, 0);
  assert.equal(s.members["920000088"], undefined);
});
test("private encounters affect personal relationship but never publish private evidence or global mood impulses", () => {
  const s = newState(at),
    k = "private:" + uid;
  conversation(s, at + M, 1, "我喜欢私密动漫", "friendly", k);
  assert.ok(s.members[uid].affinity > 18);
  assert.equal(s.lastContactAt, at);
  assert.equal(s.mood, 65);
  assert.equal(
    JSON.stringify(relationshipView(s.members[uid], at + 2 * M, key)).includes(
      "私密动漫",
    ),
    false,
  );
  assert.equal(
    JSON.stringify(s.members[uid].relation).includes("私密动漫"),
    false,
  );
});
test("a semantic correction can undo a wrongly targeted long-term event without erasing other people", () => {
  const s = newState(at);
  const { m } = conversation(s, at + M, 1, "小鲸鱼只是他的外号");
  assert.ok(s.members[uid].affinity > 18);
  observe(
    s,
    key,
    m,
    { kind: "neutral", directed: false, evidence: m.plain },
    at + 2 * M,
  );
  assert.equal(s.members[uid].affinity, 18);
  assert.equal(s.members[uid].relation.effectiveEpisodes, 0);
});
test("multi-day ledger compaction preserves daily ceilings and stable restart results", () => {
  const s = newState(at);
  for (let i = 1; i <= 300; i++)
    conversation(
      s,
      at + i * 10 * M,
      i,
      "小鲸鱼，谢谢你，独立话题" + i,
      "friendly",
    );
  assert.ok(s.members[uid].affinity <= 18 + 8 * 3);
  assert.ok(s.members[uid].relation.familiarity <= 18 + 1e-8);
  assert.ok(s.members[uid].relation.trust <= 53 + 1e-8);
  const before = s.members[uid].affinity;
  const clone = migrateState(JSON.parse(JSON.stringify(s)), at + 3010 * M);
  clone.observations = {};
  ingest(clone, {}, at + 3010 * M);
  assert.equal(clone.members[uid].affinity, before);
});
test("administrator adjustment preserves the last actual interaction time", () => {
  const s = newState(at);
  conversation(s, at + M, 1);
  const actual = s.members[uid].relation.lastEffectiveAt;
  s.members[uid].affinity = 73;
  rebaseRelationship(s.members[uid], at + 10 * M);
  ingest(s, {}, at + 20 * M);
  assert.equal(s.members[uid].affinity, 73);
  assert.equal(s.members[uid].relation.lastEffectiveAt, actual);
});
function memoryFixture(generate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relationship-memory-"));
  let now = at;
  const input = {
    active: true,
    snapshots: {
      [key]: { recentMessages: [] },
      [other]: { recentMessages: [] },
    },
  };
  const life = {
    dir,
    config: { ...DEFAULTS, semanticMemoryEnabled: true },
    state: {
      members: { [uid]: { affinity: 18, interests: {} } },
      observations: {},
    },
    inputs: () => input,
  };
  let calls = 0;
  const memory = new PersonMemory({
    life,
    now: () => now,
    generate: async (args) => {
      calls++;
      return generate
        ? generate(args)
        : { value: { keepIds: args.data.facts.slice(0, 1).map((f) => f.id) } };
    },
  });
  return {
    memory,
    life,
    input,
    add(text, n = 1, k = key) {
      now += M;
      input.snapshots[k].recentMessages.push({
        userId: uid,
        sender: "甲",
        messageId: String(n),
        plain: text,
        time: now,
      });
    },
    calls: () => calls,
    close() {
      memory.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("natural self-descriptions are collected without comma after name; title brackets are not treated as quotations", () => {
  assert.ok(
    personalFacts(uid, "小鲸鱼我最近在补《高达》", at).some(
      (f) => f.value === "高达",
    ),
  );
  assert.ok(
    personalFacts(uid, "小鲸鱼我正在学习日语", at).some(
      (f) => f.value === "日语",
    ),
  );
  assert.ok(
    personalFacts(uid, "小鲸鱼我喜欢夏目这个角色", at).some(
      (f) => f.value === "夏目这个角色",
    ),
  );
  assert.equal(personalFacts(uid, "他说我喜欢高达", at).length, 0);
});
test("batch semantic extraction handles preference changes with exact sources, no additional per-message model calls", async () => {
  const f = memoryFixture(async ({ data }) => ({
    value: {
      keepIds: [],
      facts: [
        {
          messageId: data.messages.at(-1).messageId,
          kind: "interest",
          value: "高达",
          stance: "inactive",
          evidence: data.messages.at(-1).text,
        },
      ],
    },
  }));
  try {
    f.add("小鲸鱼我喜欢高达", 0);
    f.memory.ingest(f.input);
    for (let i = 1; i <= 10; i++)
      f.add("小鲸鱼，以前很喜欢高达，现在不看高达了，近况" + i, i);
    await f.memory.tick();
    assert.equal(f.calls(), 1);
    assert.ok(
      f.memory.view(uid).facts.some((x) => x.fact === "不再关注/游玩：高达"),
    );
    await f.memory.tick();
    assert.equal(f.calls(), 1);
  } finally {
    f.close();
  }
});
test("summary prioritization never deletes archive due to low affinity; relevant older memory can be retrieved", async () => {
  const f = memoryFixture();
  try {
    for (let i = 0; i < 20; i++)
      f.add("小鲸鱼我喜欢游戏" + String.fromCharCode(65 + i), i);
    await f.memory.tick();
    assert.equal(f.memory.view(uid, { admin: true }).storedCount, 20);
    assert.equal(f.memory.view(uid).facts.length, 5);
    assert.ok(
      f.memory
        .view(uid, { query: "你喜欢游戏A吗" })
        .facts.some((x) => x.fact.includes("游戏A")),
    );
    f.life.state.members[uid].affinity = 90;
    assert.equal(f.memory.view(uid).facts.length, 18);
  } finally {
    f.close();
  }
});
test("fabricated extraction is rejected without destroying old facts; failed jobs are visible", async () => {
  const f = memoryFixture(async () => ({
    value: {
      keepIds: [],
      facts: [
        {
          messageId: "invented",
          kind: "interest",
          value: "凭空经历",
          stance: "like",
          evidence: "我喜欢凭空经历",
        },
      ],
    },
  }));
  try {
    f.add("小鲸鱼我喜欢高达", 0);
    for (let i = 1; i < 11; i++) f.add("小鲸鱼我最近换口味了，近况" + i, i);
    await f.memory.tick();
    assert.match(f.memory.error, /来源证据/);
    assert.equal(f.memory.state.jobs.at(-1).status, "failed");
    assert.ok(f.memory.view(uid).facts.some((x) => x.fact.includes("高达")));
    assert.ok(f.memory.state.people[uid].raw.length);
  } finally {
    f.close();
  }
});
test("memory and relationship focus use exactly the same real participant; admin correction is qualified and deletable", () => {
  const f = memoryFixture();
  try {
    f.add("小鲸鱼我喜欢高达", 1);
    f.memory.ingest(f.input);
    const profile = f.memory.view(uid),
      id = profile.facts[0].id;
    f.memory.correct(uid, id, "我不喜欢高达");
    const updated = f.memory.view(uid).facts.find((x) => x.id === id);
    assert.equal(updated.needsConfirmation, true);
    assert.equal(updated.fact, "不喜欢：高达");
    const focus = speakerFocus(
      f.life.state,
      key,
      f.input.snapshots[key],
      at + M,
      DEFAULTS,
    ).speakerIds.slice(0, 2);
    assert.deepEqual(f.memory.targets(f.input, key), focus);
    f.memory.forget(uid, id);
    assert.equal(f.memory.view(uid).facts.length, 0);
  } finally {
    f.close();
  }
});
test("forgetting a public interest removes legacy prompt caches but preserves private interests", () => {
  const f = memoryFixture();
  try {
    f.add("小鲸鱼我喜欢高达", 1);
    f.memory.ingest(f.input);
    f.life.state.members[uid].interests = {
      [key]: [{ topic: "高达", stance: "like", at }],
      ["private:" + uid]: [{ topic: "高达", stance: "like", at }],
    };
    f.memory.forget(uid, f.memory.view(uid).facts[0].id);
    assert.equal(f.life.state.members[uid].interests[key].length, 0);
    assert.equal(
      f.life.state.members[uid].interests["private:" + uid].length,
      1,
    );
  } finally {
    f.close();
  }
});
