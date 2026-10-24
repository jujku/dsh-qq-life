// Shared Hong Kong calendar. No model calls and no dependency on the host timezone.
import { createHash } from "node:crypto";
export const HOUR = 3600000,
  MIN = 60000,
  DAY = 24 * HOUR;
export const ROUTINE_DEFAULTS = { wakeTime: "10:00", sleepTime: "23:30" };
export function minuteOf(text) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text))
    throw Error("作息时间需要 HH:mm");
  const [h, m] = text.split(":").map(Number);
  return h * 60 + m;
}
export function routineAt(now, config = {}) {
  const c = { ...ROUTINE_DEFAULTS, ...config },
    d = new Date(now + 8 * HOUR);
  const day = d.toISOString().slice(0, 10),
    start = Date.parse(day + "T00:00:00+08:00");
  const wake = minuteOf(c.wakeTime),
    sleep = minuteOf(c.sleepTime);
  const minute = (now - start) / MIN,
    weekend = [0, 6].includes(d.getUTCDay());
  const awake = minute >= wake && minute < sleep;
  const learning =
    awake &&
    (weekend || (minute >= 12 * 60 && minute < 14 * 60) || minute >= 18 * 60);
  const phase = !awake
    ? "安静休息"
    : minute < 12 * 60
      ? "慢慢活跃"
      : minute < 14 * 60
        ? "午后闲暇"
        : minute < 18 * 60
          ? weekend
            ? "周末闲暇"
            : "聊天与休息"
          : minute < 21 * 60
            ? "晚间闲暇"
            : "整理感想，准备休息";
  return {
    day,
    start,
    awake,
    learning,
    phase,
    wakeTime: c.wakeTime,
    sleepTime: c.sleepTime,
    sleepAt: start + sleep * MIN,
    reason: !awake
      ? "作息休息时段"
      : !learning
        ? "作息聊天与休息时段"
        : "可在闲时学习",
  };
}
export function routineDuration(from, to, c = {}, learning = true) {
  let total = 0;
  from = Math.max(from, to - 14 * DAY);
  while (from < to) {
    const r = routineAt(from, c),
      end = Math.min(to, r.start + DAY);
    const wake = r.start + minuteOf(r.wakeTime) * MIN,
      sleep = r.start + minuteOf(r.sleepTime) * MIN;
    const weekend = [0, 6].includes(new Date(r.start + 8 * HOUR).getUTCDay());
    const ranges =
      learning && !weekend
        ? [
            [12 * 60, 14 * 60],
            [18 * 60, 24 * 60],
          ]
        : [[0, 24 * 60]];
    for (const [a, b] of ranges)
      total += Math.max(
        0,
        Math.min(end, sleep, r.start + b * MIN) -
          Math.max(from, wake, r.start + a * MIN),
      );
    from = end;
  }
  return total;
}
export function routineSegments(from, to, c = {}) {
  const result = [];
  from = Math.max(from, to - 14 * DAY);
  while (from < to) {
    const r = routineAt(from, c);
    const boundaries = [
      r.start + minuteOf(r.wakeTime) * MIN,
      r.sleepAt,
      r.start + DAY,
    ].filter((t) => t > from);
    const end = Math.min(to, ...boundaries);
    result.push({ hours: (end - from) / HOUR, awake: r.awake });
    from = end;
  }
  return result;
}
export function ensureRoutinePlan(s, now, c = {}) {
  const r = routineAt(now, c),
    signature = r.wakeTime + "|" + r.sleepTime;
  if (s.routine?.day === r.day && s.routine.signature === signature)
    return s.routine;
  const old = s.routine?.day === r.day ? s.routine.opportunities : [];
  const opportunities = [];
  for (const [id, a, b] of [
    ["afternoon", 13 * 60, 14 * 60],
    ["evening", 21 * 60, 23 * 60 + 20],
  ]) {
    const from = Math.max(a, minuteOf(r.wakeTime)),
      until = Math.min(b, minuteOf(r.sleepTime));
    if (until - from < 10) continue;
    const h =
      createHash("sha256")
        .update(`${s.startedAt}|${r.day}|${id}`)
        .digest()
        .readUInt32BE(0) / 4294967296;
    const previous = old?.find((x) => x.id === id);
    opportunities.push(
      previous?.status && previous.status !== "pending"
        ? previous
        : {
            id,
            at: r.start + (from + h * (until - from - 5)) * MIN,
            until: r.start + until * MIN,
            status: "pending",
          },
    );
  }
  s.routine = { version: 1, day: r.day, signature, opportunities };
  return s.routine;
}
export function postOpportunity(s, now, c = {}) {
  if (!routineAt(now, c).awake) return null;
  const plan = ensureRoutinePlan(s, now, c);
  // Two reflection opportunities share a single ledger. Unknown sends remain consumed.
  if (s.jobs.filter((j) => j.kind === "post" && j.day === plan.day).length >= 2)
    return null;
  if (s.jobs.some((j) => j.kind === "post" && now - j.at < 3 * HOUR))
    return null;
  return (
    plan.opportunities.find(
      (x) => x.status === "pending" && now >= x.at && now < x.until,
    ) || null
  );
}
export function routineView(s, now, c = {}) {
  const r = routineAt(now, c),
    plan = ensureRoutinePlan(s, now, c);
  return {
    ...r,
    opportunities: plan.opportunities,
    usedToday: s.jobs.filter((j) => j.kind === "post" && j.day === r.day)
      .length,
    note: "午后、晚间各一次整理感想的机会；有真实经历才考虑分享，没有内容就跳过。",
  };
}
