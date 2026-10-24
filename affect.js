// Original lightweight implementation inspired by PAD / OpenFeelz's separate
// valence, activation and energy, plus exponential return to baseline.
// These are interaction-design rules, not a psychological diagnosis.
import { routineAt, routineSegments, HOUR, MIN } from "./routine.js";
const clamp = (n) => Math.min(100, Math.max(0, n));
const settle = (v, target, hours, halfLife) =>
  target + (v - target) * Math.pow(0.5, hours / halfLife);
export function ensureAffect(s) {
  return (s.affect ||= {
    version: 1,
    arousal: 32,
    energy: 70,
    traces: [],
    lastMoodCredit: 0,
  });
}
export function advanceAffect(s, from, to, c, routine = {}) {
  const a = ensureAffect(s),
    hours = (to - from) / HOUR;
  a.arousal = settle(a.arousal, 32, hours, 0.65);
  for (const part of routineSegments(from, to, routine))
    a.energy = clamp(a.energy + part.hours * (part.awake ? -0.8 : 12));
  a.traces = a.traces.filter((t) => to - t.at < 6 * HOUR).slice(-120);
}
export function signalAffect(
  s,
  key,
  uid,
  kind,
  now,
  id,
  moodDelta,
  c,
  { interest = false } = {},
) {
  if (!key.startsWith("group:")) return { mood: 0, arousal: 0, energy: 0 };
  const a = ensureAffect(s),
    before = { mood: s.mood, arousal: a.arousal, energy: a.energy };
  const repeats = a.traces.filter(
    (t) => t.uid === uid && t.kind === kind && now - t.at < HOUR,
  ).length;
  const novelty = 1 / (1 + repeats * 0.7);
  // Global credit avoids a busy group keeping her permanently at 100.
  if (moodDelta <= 0 || now - a.lastMoodCredit >= 2 * MIN) {
    const headroom = moodDelta > 0 ? Math.min(1, (100 - s.mood) / 40) : 1;
    s.mood = clamp(s.mood + moodDelta * headroom * novelty);
    if (moodDelta > 0) a.lastMoodCredit = now;
  }
  const activation =
    {
      insult: 17,
      praise: 10,
      friendly: 6,
      playful: 9,
      apology: -9,
      neutral: 2,
    }[kind] || 0;
  a.arousal = clamp(a.arousal + (activation + (interest ? 5 : 0)) * novelty);
  a.energy = clamp(a.energy - (kind === "insult" ? 2.5 : 0.8) * novelty);
  a.traces.push({ id, key, uid, kind, at: now, strength: novelty, interest });
  a.traces = a.traces.slice(-120);
  return {
    mood: s.mood - before.mood,
    arousal: a.arousal - before.arousal,
    energy: a.energy - before.energy,
  };
}
export function affectView(s, key, now, routine = {}) {
  const a = ensureAffect(s),
    r = routineAt(now, routine);
  const recent = a.traces
    .filter((t) => t.key === key && now - t.at < 2 * HOUR)
    .map((t) => ({
      ...t,
      intensity: t.strength * Math.pow(0.5, (now - t.at) / (45 * MIN)),
    }));
  const dominant = recent
    .filter((t) => t.kind !== "neutral" || t.interest)
    .sort((x, y) => y.intensity - x.intensity)[0];
  const feelings = {
    praise: "有点被夸得不好意思",
    friendly: "被友善对待后的温暖",
    insult: "刚才有些不舒服",
    apology: "气氛在缓和",
    playful: "有点想接梗",
  };
  const feeling =
    dominant && dominant.intensity > 0.15
      ? dominant.interest
        ? "聊到喜欢的话题，有些来劲"
        : feelings[dominant.kind]
      : "情绪已慢慢平复";
  const tone = !r.awake
    ? "困倦，简短接话"
    : a.energy < 30
      ? "有点累，想安静待着"
      : s.mood >= 75 && a.arousal < 48
        ? "放松满足，懒洋洋地开心"
        : a.arousal >= 65
          ? "情绪鲜明，但不需要每句都很激动"
          : s.mood < 40
            ? "有些低落，慢慢恢复"
            : "平静，自然接话";
  return {
    arousal: Math.round(a.arousal),
    energy: Math.round(a.energy),
    feeling,
    tone,
    phase: r.phase,
  };
}
