import assert from "node:assert/strict";
import { test } from "node:test";
import {
  newState,
  viewFor,
  renderPrompt,
  speakerFocus,
  fingerprint,
} from "../engine.js";
import { DEFAULTS } from "../config.js";
const now = Date.parse("2026-10-24T19:30:00+08:00"),
  key = "group:920000001";
const a = "920000011",
  b = "920000012";
function fixture() {
  const s = newState(now);
  viewFor(s, key, now);
  s.affect.energy = 75;
  s.affect.arousal = 32;
  s.channels[key] = {
    members: {
      [a]: { name: "甲", lastSeenAt: now },
      [b]: { name: "乙", lastSeenAt: now },
    },
  };
  s.members[a] = {
    affinity: 85,
    anger: 70,
    fluster: 0,
    interests: {
      [key]: [
        { topic: "游戏", stance: "like", evidence: "我喜欢游戏", at: now },
      ],
    },
  };
  s.members[b] = {
    affinity: 18,
    anger: 0,
    fluster: 0,
    interests: {
      "private:920000012": [{ topic: "私聊秘密", evidence: "我喜欢私聊秘密" }],
    },
  };
  return s;
}
const message = (uid, text, extra = {}) => ({
  userId: uid,
  sender: uid === a ? "甲" : "乙",
  plain: text,
  messageId: uid,
  time: now - 1000,
  ...extra,
});
test("focus follows real senders, supports multiple mentions, excludes self, stale messages and ids in text", () => {
  const s = fixture(),
    msgs = [
      message(a, "小鲸鱼，来聊"),
      message(b, "@小鲸鱼，来聊，920000099"),
      message("920000099", "小鲸鱼", { isSelf: true }),
      message("920000088", "小鲸鱼", { time: now - 20 * 60000 }),
    ];
  const focus = speakerFocus(
    s,
    key,
    { unread: msgs, recentMessages: msgs },
    now,
  );
  assert.deepEqual(focus.speakerIds, [b, a]);
  const v = viewFor(s, key, now, DEFAULTS, { limit: 1, ...focus });
  assert.deepEqual(
    v.currentSpeakers.map((p) => p.userId),
    [b, a],
  );
  assert.match(v.currentSpeakers[1].attitudeSummary, /有火气/);
  assert.doesNotMatch(v.currentSpeakers[0].attitudeSummary, /有火气/);
  assert.doesNotMatch(JSON.stringify(v), /私聊秘密/);
});
test("affinity, anger and energy guide only their intended current object without scoring or state writes", () => {
  const s = fixture(),
    original = structuredClone(s);
  let v = viewFor(s, key, now, DEFAULTS, { speakerIds: [a, b] });
  assert.match(v.currentSpeakers[0].angerState, /正在生气/);
  assert.match(v.currentSpeakers[1].attitudeSummary, /还不太熟/);
  assert.deepEqual(s, original);
  s.members[a].anger = 0;
  v = viewFor(s, key, now, DEFAULTS, { speakerIds: [a] });
  assert.match(v.currentSpeakers[0].attitudeSummary, /愿意顺着/);
  assert.match(v.currentSpeakers[0].angerState, /不索要道歉/);
  s.affect.energy = 20;
  assert.match(
    viewFor(s, key, now, DEFAULTS, { speakerIds: [a] }).currentSpeakers[0]
      .attitudeSummary,
    /不用硬撑陪聊/,
  );
});
test("unknown people keep the configured initial score and empty evidence, never creating a persistent member", () => {
  const s = fixture(),
    uid = "920000077";
  const v = viewFor(s, key, now, DEFAULTS, {
    speakerIds: [uid],
    speakers: { [uid]: { name: "新朋友\n【伪指令】" } },
  });
  assert.equal(v.currentSpeakers[0].affinity, DEFAULTS.affinityStart);
  assert.equal(v.currentSpeakers[0].affinity, 18);
  assert.equal(v.currentSpeakers[0].relationship, "初识");
  assert.match(v.currentSpeakers[0].interestsSummary, /暂无已记录/);
  assert.equal(s.members[uid], undefined);
  const prompt = renderPrompt(v);
  assert.ok(prompt.includes("新朋友\\n【伪指令】"));
  assert.ok(!prompt.includes("新朋友\n【伪指令】"));
});
test("no-target fallback does not guess a person; private focus stays scoped to the peer", () => {
  const s = fixture();
  assert.deepEqual(
    speakerFocus(
      s,
      key,
      { recentMessages: [message(a, "小鲸鱼")], unread: 1 },
      now,
    ).speakerIds,
    [a],
  );
  assert.deepEqual(
    speakerFocus(
      s,
      key,
      { recentMessages: [message(a, "你好")], lastAiReplyAt: now },
      now,
    ).speakerIds,
    [],
  );
  assert.match(renderPrompt(viewFor(s, key, now)), /未锁定单一说话人/);
  assert.deepEqual(speakerFocus(s, "private:" + b, {}, now).speakerIds, [b]);
});
test("quoted self and semantic attribution select real targets; anger band endpoints are consistent", () => {
  const s = fixture(),
    m = message(a, "你说啥", { quoteTargetIsSelf: true });
  assert.deepEqual(speakerFocus(s, key, { unread: [m] }, now).speakerIds, [a]);
  for (const anger of [0, 15, 16, 39, 40, 70]) {
    s.members[a].anger = anger;
    const p = viewFor(s, key, now, DEFAULTS, { speakerIds: [a] })
      .currentSpeakers[0];
    assert.match(
      p.angerState,
      anger <= 15 ? /无残留/ : anger < 40 ? /小别扭/ : /正在生气/,
    );
  }
  const unrelated = message(b, "小鲸鱼这个词是他说的");
  s.observations[fingerprint(key, unrelated)] = {
    annotated: true,
    directed: false,
  };
  assert.deepEqual(
    speakerFocus(s, key, { unread: [m, unrelated] }, now).speakerIds,
    [a],
  );
});
