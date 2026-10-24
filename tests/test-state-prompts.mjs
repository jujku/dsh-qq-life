import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, validateConfig } from "../config.js";
import {
  STATE_PROMPT_DEFINITIONS,
  validateStatePrompts,
  stateText,
} from "../state-prompts.js";
import { newState, viewFor, renderPrompt } from "../engine.js";
const now = Date.parse("2026-10-25T19:30:00+08:00"),
  key = "group:920000001",
  uid = "920000011";
function fixture() {
  const s = newState(now);
  viewFor(s, key, now);
  s.affect.energy = 75;
  s.affect.arousal = 30;
  s.channels[key] = {
    members: { [uid]: { name: "虚构群友", lastSeenAt: now } },
  };
  s.members[uid] = { affinity: 85, anger: 0, fluster: 0, interests: {} };
  return s;
}
const view = (s, cfg) => viewFor(s, key, now, cfg, { speakerIds: [uid] });
test("state templates support partial overrides, multiline, legacy defaults and explicit reset", () => {
  assert.equal(STATE_PROMPT_DEFINITIONS.length, 16);
  const c = validateConfig({
    statePrompts: { angry: "现在不太想接话\n怒气{anger}", close: "  " },
  });
  assert.equal(c.statePrompts.angry, "现在不太想接话\n怒气{anger}");
  assert.equal(Object.hasOwn(c.statePrompts, "close"), false);
  assert.equal(
    stateText("angry", { anger: 61.4 }, c.statePrompts),
    "现在不太想接话\n怒气61",
  );
  assert.equal(stateText("guarded", {}, c.statePrompts), stateText("guarded"));
  const saved = validateConfig({ moodGain: 1 }, c);
  assert.deepEqual(saved.statePrompts, c.statePrompts);
  assert.deepEqual(validateConfig({ statePrompts: {} }, c).statePrompts, {});
  assert.equal(Object.hasOwn(DEFAULTS.statePrompts, "angry"), false);
});
test("unknown states, host interpolation, bad placeholders, controls and oversized templates are rejected", () => {
  for (const input of [
    [],
    null,
    { unknown: "x" },
    JSON.parse('{"__proto__":"x"}'),
    { angry: "{{cwd}}" },
    { angry: "{password}" },
    { angry: "x\u0000y" },
    { angry: "x".repeat(801) },
  ])
    assert.throws(() => validateStatePrompts(input));
  const oversized = Object.fromEntries(
    STATE_PROMPT_DEFINITIONS.map((d) => [d.id, "x".repeat(800)]),
  );
  assert.throws(() => validateStatePrompts(oversized), /6000/);
});
test("only matching templates are injected and angry/fatigue priority survives overrides", () => {
  const s = fixture(),
    original = structuredClone(s);
  const cfg = validateConfig({
    statePrompts: {
      angry: "专属生气描述{anger}",
      exhausted: "精力不足{energy}",
      close: "亲近描述{affinity}",
      stranger: "初识描述",
      boredomHigh: "无聊描述",
      expressive: "兴奋描述",
    },
  });
  const v = view(s, cfg);
  assert.match(v.currentSpeakers[0].attitudeSummary, /亲近描述85/);
  assert.doesNotMatch(renderPrompt(v), /专属生气描述|初识描述/);
  assert.deepEqual(
    s,
    original,
    "custom prompts must not change scores or state",
  );
  s.affect.energy = 20;
  assert.match(view(s, cfg).currentSpeakers[0].attitudeSummary, /精力不足20/);
  s.members[uid].anger = 70;
  s.affect.arousal = 90;
  s.boredom = 100;
  const angry = view(s, cfg);
  assert.match(angry.currentSpeakers[0].attitudeSummary, /专属生气描述70/);
  assert.doesNotMatch(
    renderPrompt(angry),
    /亲近描述|精力不足|兴奋描述|无聊描述/,
  );
});
test("global moods and shyness use their matching templates while fixed persona boundaries remain", () => {
  const s = fixture();
  const cfg = validateConfig({
    statePrompts: {
      moodHigh: "满足而不亢奋{mood}",
      moodLow: "低落描述",
      moodNeutral: "平稳描述",
      flustered: "含羞描述{fluster}",
      tsundere: "嘴硬描述{tsundere}",
    },
  });
  s.mood = 90;
  s.members[uid].fluster = 35;
  const text = renderPrompt(view(s, cfg));
  assert.match(text, /满足而不亢奋90/);
  assert.match(text, /含羞描述35/);
  assert.match(text, /嘴硬描述70/);
  assert.doesNotMatch(text, /低落描述|平稳描述/);
  assert.match(text, /必须服从原人格卡与权限边界/);
  assert.match(text, /不改变身份、性格、关系事实或发送许可/);
  s.mood = 25;
  assert.match(renderPrompt(view(s, cfg)), /低落描述/);
  s.mood = 60;
  assert.match(renderPrompt(view(s, cfg)), /平稳描述/);
});
