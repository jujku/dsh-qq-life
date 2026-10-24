// Deterministic long-term relationships. No model, timer, network or filesystem.
import { createHash } from "node:crypto";
const DAY = 86400000,
  MIN = 60000;
// Calibrations live in one place, outside prompts and UI. Each encounter stores
// the policy it used so a future adjustment only affects future encounters.
export const RELATION_RULES = Object.freeze({
  familiarityPerEpisode: 1.4,
  familiarityPerDay: 6,
  friendlyWeight: 0.7,
  playfulWeight: 0.4,
  praiseWeight: 0.35,
  ordinaryWeight: 0.08,
  growthExponent: 1.5,
  trustLoss: 4,
  trustFriendly: 0.4,
  trustPlayful: 0.1,
  trustPerDay: 1,
});
const bound = (n) => Math.max(0, Math.min(100, n));
const day = (at) => new Date(at + 8 * 3600000).toISOString().slice(0, 10);
const idFor = (key, m) =>
  key +
  (m.messageId
    ? ":id:" + m.messageId
    : ":seq:" + m.seq + ":" + Number(m.time || 0));
const clean = (s) =>
  /密码|密钥|api.?key|token|诊断|病历|性取向|住址|手机号|sk-[\w-]+/i.test(
    String(s),
  )
    ? "[互动内容已略去]"
    : String(s || "")
        .replace(/https?:\S+|\d{7,}|[\x00-\x1f]/g, " ")
        .slice(0, 100);
const normalized = (s) =>
  createHash("sha256")
    .update(
      String(s || "")
        .toLowerCase()
        .replace(/小鲸鱼|deepseek|大肥鱼|\s|[\p{P}\p{S}]/gu, ""),
    )
    .digest("hex");

export function initializeRelationships(state, now) {
  if (!Number.isFinite(state.relationshipStartedAt))
    state.relationshipStartedAt = now;
  for (const m of Object.values(state.members || {})) {
    if (!m.relation)
      m.relation = {
        version: 1,
        base: { affinity: m.affinity, familiarity: 0, trust: 50, episodes: 0 },
        episodes: [],
        seen: [],
        lastEffectiveAt: 0,
        calculatedAffinity: m.affinity,
      };
  }
}
function calculate(base, episodes, observations, cfg) {
  const score = { ...base },
    caps = {},
    history = [];
  for (const e of episodes) {
    const rules = { ...RELATION_RULES, ...cfg, ...e.rules };
    const active = e.records.filter((r) => {
      const o = observations[r.id];
      return o?.annotated ? o.directed : !r.annotated || r.directed !== false;
    });
    const kinds = active.map((r) => {
      const o = observations[r.id];
      return o?.annotated && o.directed
        ? o.kind
        : r.annotated
          ? r.kind
          : "neutral";
    });
    const kind = kinds.includes("insult")
      ? "insult"
      : kinds.includes("friendly")
        ? "friendly"
        : kinds.includes("playful")
          ? "playful"
          : kinds.includes("praise")
            ? "praise"
            : kinds.includes("apology")
              ? "apology"
              : "neutral";
    const cap = (caps[day(e.at)] ||= { affinity: 0, familiarity: 0, trust: 0 });
    const duplicate = e.duplicate || !active.length;
    const f = duplicate
      ? 0
      : Math.max(
          0,
          Math.min(
            rules.familiarityPerEpisode,
            rules.familiarityPerDay - cap.familiarity,
          ),
        );
    const raw =
      kind === "insult"
        ? -rules.insultLoss
        : kind === "friendly"
          ? rules.affinityGain * rules.friendlyWeight
          : kind === "playful"
            ? rules.affinityGain * rules.playfulWeight
            : kind === "praise"
              ? rules.positiveBonus * rules.praiseWeight
              : kind === "apology"
                ? 0
                : rules.affinityGain * rules.ordinaryWeight;
    const delta = duplicate
      ? 0
      : raw <= 0
        ? raw
        : Math.min(
            raw * Math.pow((100 - score.affinity) / 100, rules.growthExponent),
            Math.max(0, rules.maxAffinityGainPerDay - cap.affinity),
          );
    const t = duplicate
      ? 0
      : kind === "insult"
        ? -rules.trustLoss
        : kind === "friendly"
          ? Math.min(
              rules.trustFriendly,
              Math.max(0, rules.trustPerDay - cap.trust),
            )
          : kind === "playful"
            ? Math.min(
                rules.trustPlayful,
                Math.max(0, rules.trustPerDay - cap.trust),
              )
            : 0;
    score.affinity = bound(score.affinity + delta);
    score.familiarity = bound(score.familiarity + f);
    score.trust = bound(score.trust + t);
    score.episodes += duplicate ? 0 : 1;
    if (!duplicate) score.lastEffectiveAt = e.at;
    cap.affinity += Math.max(0, delta);
    cap.familiarity += f;
    cap.trust += Math.max(0, t);
    history.push({
      at: e.at,
      key: e.key,
      kind,
      evidence: e.records.at(-1)?.evidence || "",
      affinityChange: delta,
      familiarityChange: f,
      trustChange: t,
      duplicate,
      score: { ...score },
    });
  }
  return { score, history };
}

export function reconcileRelationships(state, snapshots, now, cfg) {
  initializeRelationships(state, now);
  for (const m of Object.values(state.members))
    if (
      m.relation.calculatedAffinity !== undefined &&
      Math.abs(m.affinity - m.relation.calculatedAffinity) > 1e-8
    )
      rebaseRelationship(m, now);
  const confirmed = [];
  for (const [key, snapshot] of Object.entries(snapshots)) {
    const messages = (snapshot.recentMessages || [])
      .filter(
        (m) => Number.isFinite(m.time) && m.time <= now && now - m.time < DAY,
      )
      .sort((a, b) => a.time - b.time);
    const own = messages.filter((m) => m.isSelf);
    const receipts = [
      ...own.map((m) => ({ at: m.time, replyTo: m.replyToMessageId })),
      ...(!own.length && snapshot.lastAiReplyAt
        ? [{ at: snapshot.lastAiReplyAt }]
        : []),
    ];
    for (const receipt of receipts) {
      if (receipt.at < state.relationshipStartedAt || receipt.at > now)
        continue;
      const priorSelf = Math.max(
        state.relationshipStartedAt,
        ...own.filter((m) => m.time < receipt.at).map((m) => m.time),
      );
      const candidates = messages.filter((m) => {
        const o = state.observations[idFor(key, m)];
        return (
          !m.isSelf &&
          o &&
          !o.baseline &&
          o.directed &&
          m.time >= priorSelf &&
          m.time <= receipt.at &&
          receipt.at - m.time <= 8 * MIN &&
          state.members[String(m.userId)]
        );
      });
      const targets = receipt.replyTo
        ? candidates.filter(
            (m) => String(m.messageId) === String(receipt.replyTo),
          )
        : [...new Set(candidates.map((m) => String(m.userId)))].length === 1
          ? candidates
          : [];
      for (const m of targets) confirmed.push({ key, m });
    }
  }
  for (const { key, m } of confirmed.sort((a, b) => a.m.time - b.m.time)) {
    const person = state.members[String(m.userId)],
      r = person.relation,
      id = idFor(key, m);
    if (r.seen.includes(id)) continue;
    const content = normalized(m.plain || m.text);
    const previous = r.episodes.at(-1);
    const duplicate = r.episodes.some(
      (e) =>
        m.time - e.at < DAY && e.records.some((x) => x.content === content),
    );
    const record = {
      id,
      key,
      at: m.time,
      messageId: String(m.messageId || ""),
      evidence: key.startsWith("private:")
        ? "[私聊互动，不向群聊透露]"
        : clean(m.plain || m.text),
      content,
    };
    if (
      previous &&
      m.time - previous.at >= 0 &&
      m.time - previous.at < cfg.relationCreditMinutes * MIN
    ) {
      if (previous.records.length < 12) previous.records.push(record);
      previous.duplicate = previous.duplicate && duplicate;
    } else {
      r.episodes.push({
        at: m.time,
        key,
        records: [record],
        duplicate,
        rules: {
          ...RELATION_RULES,
          ...Object.fromEntries(
            [
              "affinityGain",
              "positiveBonus",
              "insultLoss",
              "maxAffinityGainPerDay",
            ].map((k) => [k, cfg[k]]),
          ),
        },
      });
    }
    r.seen.push(id);
    r.seen = r.seen.slice(-3000);
    if (!r.episodes.at(-1).duplicate)
      r.lastEffectiveAt = Math.max(r.lastEffectiveAt || 0, m.time);
  }
  for (const m of Object.values(state.members)) {
    const r = m.relation;
    let result = calculate(r.base, r.episodes, state.observations, cfg);
    if (
      r.episodes.length > 240 &&
      day(r.episodes[0].at) !== day(r.episodes.at(-1).at)
    ) {
      const oldestDay = day(r.episodes[0].at);
      const remove = r.episodes.findIndex((e) => day(e.at) !== oldestDay);
      r.base = result.history[remove - 1].score;
      r.episodes = r.episodes.slice(remove);
      result = calculate(r.base, r.episodes, state.observations, cfg);
    }
    // Freeze semantic labels with their evidence before the short observation
    // window is pruned; absence of a later annotation must not reset history.
    for (const e of r.episodes)
      for (const rec of e.records) {
        const o = state.observations[rec.id];
        if (o?.annotated) {
          rec.kind = o.directed ? o.kind : "neutral";
          rec.directed = o.directed;
          rec.annotated = true;
        }
      }
    m.affinity = result.score.affinity;
    r.calculatedAffinity = m.affinity;
    r.familiarity = result.score.familiarity;
    r.trust = result.score.trust;
    r.effectiveEpisodes = result.score.episodes;
    r.lastEffectiveAt = result.score.lastEffectiveAt || 0;
    r.history = result.history.slice(-8).map(({ score, ...h }) => h);
  }
}
export function relationshipView(m, now, key) {
  const r = m?.relation;
  if (!r)
    return {
      known: false,
      familiarity: null,
      trust: null,
      recentFamiliarity: null,
      summary: "旧关系保留；新增维度尚无可核实交往",
    };
  const known = r.effectiveEpisodes > 0;
  const recent =
    (r.familiarity || 0) *
    Math.pow(
      0.5,
      Math.max(0, now - (r.lastEffectiveAt || now) - 7 * DAY) / (30 * DAY),
    );
  return {
    known,
    familiarity: known ? Math.round(r.familiarity) : null,
    trust: known ? Math.round(r.trust) : null,
    recentFamiliarity: known ? Math.round(recent) : null,
    effectiveEpisodes: r.effectiveEpisodes || 0,
    summary: !known
      ? "旧好感保留，尚无新版有效交往；不猜测熟悉或信任"
      : `${r.familiarity >= 40 ? "经常交往" : r.familiarity >= 12 ? "逐渐熟悉" : "正在认识"}；${r.trust < 35 ? "相处有所保留" : r.trust >= 65 ? "相处较安心" : "信任仍在形成"}；熟悉不等于亲近，信任不赋予权限`,
    history: (r.history || [])
      .filter((h) => h.key === key)
      .map((h) => ({ ...h, key: undefined })),
  };
}
export function rebaseRelationship(m, now) {
  m.relation = {
    version: 1,
    base: {
      affinity: m.affinity,
      familiarity: m.relation?.familiarity || 0,
      trust: m.relation?.trust ?? 50,
      episodes: m.relation?.effectiveEpisodes || 0,
      lastEffectiveAt: m.relation?.lastEffectiveAt || 0,
    },
    episodes: [],
    seen: m.relation?.seen || [],
    lastEffectiveAt: m.relation?.lastEffectiveAt || 0,
    adminAdjustedAt: now,
    calculatedAffinity: m.affinity,
  };
}
