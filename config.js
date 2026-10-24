// All tunable numbers live here. Adding a numeric rule also adds its editor to the DSH UI.
import { minuteOf } from "./routine.js";
import { validateStatePrompts } from "./state-prompts.js";
export const FIELDS = {
  enabled: ["启用情绪与关系", true],
  roleName: ["仅匹配角色名（留空使用当前角色）", ""],
  names: ["角色称呼（逗号分隔）", "小鲸鱼,鲸鱼娘,大肥鱼,DeepSeek"],
  wakeTime: ["起床时间（UTC+8，HH:mm）", "10:00"],
  sleepTime: ["休息时间（UTC+8，HH:mm）", "23:30"],
  leisureIntegration: ["联动已安装的 qq-leisure（可选）", false],
  semanticMemoryEnabled: ["启用闲时模型整理资料（产生额外用量）", false],
  summaryProvider: ["资料整理使用的 DSH provider ID", "deepseek-official"],
  summaryModel: ["资料整理使用的 DSH model ID", "deepseek-flash"],
  tsundere: ["傲娇程度", 70, 0, 100],
  shyness: ["含羞程度", 65, 0, 100],
  moodStart: ["初始心情", 65, 0, 100],
  moodFloor: ["无人聊天时的心情下限", 35, 0, 80],
  moodDecayPerHour: ["冷落时心情回落速度", 1.5, 0, 10],
  moodRecoveryPerHour: ["低落后自然恢复速度", 3, 0, 20],
  idleGraceHours: ["多久无人互动才降心情（小时）", 1, 0, 24],
  boredomStart: ["初始无聊值", 15, 0, 100],
  learningMoodGain: ["完成一段真实学习增加心情", 1, 0, 5],
  learningBoredomRelief: ["完成一段真实学习降低无聊", 8, 0, 30],
  boredomRisePerHour: ["每小时无聊增长", 12, 0, 50],
  boredomRelief: ["有效互动减少无聊", 12, 0, 50],
  moodGain: ["有效互动增加心情", 2, 0, 10],
  angerGain: ["被明确辱骂增加怒气", 20, 1, 50],
  angerDecayPerHour: ["每小时消气", 10, 0, 50],
  affinityStart: ["陌生人的初始好感", 18, 0, 60],
  affinityGain: ["亲近增长基准（已回应交往，随质量与亲近衰减）", 1.2, 0, 5],
  positiveBonus: ["明确夸奖的亲近增长基准（限频与衰减）", 1.2, 0, 5],
  insultLoss: ["被明确辱骂减少好感", 3, 0, 15],
  maxAffinityGainPerDay: ["同一人每天最多增加好感", 8, 0, 30],
  relationCreditMinutes: ["同一人连续交往合并窗口（分钟）", 8, 1, 120],
  proactiveEnabled: ["启用主动找群友", false],
  proactiveGroups: ["允许主动聊天的群号（逗号分隔）", ""],
  boredomThreshold: ["主动聊天的无聊门槛", 65, 20, 100],
  highAffinity: ["亲近关系门槛", 65, 40, 95],
  minIdleMinutes: ["群安静至少多久再主动（分钟）", 75, 15, 1440],
  cooldownMinutes: ["同一群主动聊天冷却（分钟）", 180, 30, 2880],
  maxPerDay: ["每群每天最多主动几次", 2, 0, 8],
  awakeStart: ["主动聊天开始时间（香港时区）", 10, 0, 23],
  awakeEnd: ["主动聊天结束时间（不含）", 23, 1, 24],
  targetCooldownHours: ["再次主动找同一个人的间隔（小时）", 24, 1, 168],
  unansweredBackoffHours: ["没人回应后至少安静多久（小时）", 12, 3, 168],
};
export const DEFAULTS = {
  ...Object.fromEntries(Object.entries(FIELDS).map(([key, v]) => [key, v[1]])),
  statePrompts: {},
};
export function validateConfig(patch, base = DEFAULTS) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("配置应为对象");
  const out = { ...base, statePrompts: { ...(base.statePrompts || {}) } };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "statePrompts") {
      out.statePrompts = validateStatePrompts(value);
      continue;
    }
    const spec = FIELDS[key];
    if (!spec) throw new Error("未知参数：" + key);
    if (typeof spec[1] === "boolean") {
      if (typeof value !== "boolean") throw new Error(key + " 必须为开关");
    } else if (typeof spec[1] === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < spec[2] ||
        value > spec[3]
      )
        throw new Error(key + " 超出允许范围");
      if (
        ["maxPerDay", "awakeStart", "awakeEnd"].includes(key) &&
        !Number.isInteger(value)
      )
        throw new Error(key + " 必须为整数");
    } else if (
      typeof value !== "string" ||
      value.length > 300 ||
      /[\x00-\x1f]/.test(value)
    )
      throw new Error(key + " 文本无效");
    out[key] = value;
  }
  if (out.awakeStart >= out.awakeEnd)
    throw new Error("开始时间必须早于结束时间");
  if (minuteOf(out.wakeTime) >= minuteOf(out.sleepTime))
    throw new Error("起床时间必须早于休息时间（暂不支持跨午夜）");
  if (!out.summaryProvider.trim() || !out.summaryModel.trim())
    throw new Error("资料整理的 provider 和 model 不能为空");
  if (
    out.proactiveGroups &&
    out.proactiveGroups
      .split(/[,，\s]+/)
      .some((v) => !/^[1-9]\d{4,14}$/.test(v))
  )
    throw new Error("主动群号无效");
  return out;
}
