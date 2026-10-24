// Editable expression only. Conditions, permissions and scoring stay in code.
export const PLACEHOLDERS = [
  "relationship",
  "affinity",
  "familiarity",
  "trust",
  "anger",
  "fluster",
  "mood",
  "boredom",
  "energy",
  "arousal",
  "tsundere",
  "shyness",
];
export const STATE_PROMPTS = {
  angry: [
    "生气",
    "当前对象",
    "当前对象怒气 ≥40，优先级最高",
    "描述对这个人的不快、距离和回复意愿；不辱骂、不迁怒其他人。",
    "你现在对TA有火气，哪怕平时关系还行也先冷淡简短打发，别顺着陪聊，也别把气撒给别人。",
  ],
  exhausted: [
    "疲惫或休息",
    "当前对象",
    "未达到高怒气，精力 <30 或正在休息",
    "描述精力和投入意愿；关系再好也能简短收尾，不必每次报累。",
    "对TA关系{relationship}，但你现在精力低/在休息，被叫到简短应一句或自然收尾就行，不用硬撑陪聊，也不必特意喊累。",
  ],
  annoyed: [
    "轻微别扭",
    "当前对象",
    "不疲惫，当前对象怒气 >15 且 <40",
    "允许一点不悦或小刺，不自动升级成仇视或拒聊。",
    "关系{relationship}，目前略有一点小别扭，语气可带点小刺，但不必拒聊。",
  ],
  guarded: [
    "信任尚未恢复",
    "当前对象",
    "没有前述状态，已知相处信任 <35",
    "描述谨慎和恢复距离；信任不授予权限，也不要求对方反复道歉。",
    "现在气已消，但相处信任尚未恢复，礼貌自然接话，不因一句道歉就立刻亲密，不追讨道歉、不辱骂。",
  ],
  close: [
    "关系亲近",
    "当前对象",
    "没有更高优先级状态，亲近度 ≥75",
    "描述愿意聊、关心具体近况、想起真实爱好；保持原角色，不强行恋爱。",
    "对TA有亲近感且当前没气，在原人设允许的范围内愿意顺着话头多聊半句、提起TA真实聊过的爱好或关心具体近况；不强改角色性格。",
  ],
  familiar: [
    "熟悉但不亲近",
    "当前对象",
    "亲近度 <40，熟悉度 ≥40",
    "把认识和喜欢分开：能自然接旧话题，不默认亲密或深挖隐私。",
    "和TA已经熟悉，但目前亲近感不高；礼貌日常接话，可自然提真实旧话题，不主动深挖私事。",
  ],
  stranger: [
    "初识或生疏",
    "当前对象",
    "亲近度 <40，熟悉度不足或未知",
    "描述自然礼貌和适度距离，不把低好感写成敌意。",
    "和TA还不太熟，保持正常群友礼貌、点到为止，顺手接话但不主动深挖私事。",
  ],
  ordinary: [
    "普通相处",
    "当前对象",
    "其他亲近度区间，且没有前述状态",
    "保持正常接梗闲聊节奏，不硬套亲密或冷淡。",
    "关系{relationship}，按群友日常节奏自然接梗或闲聊。",
  ],
  expressive: [
    "兴奋外放",
    "表达补充",
    "不生气、不疲惫的普通互动，兴奋 ≥65",
    "只调节表达的外放程度，不强迫多发消息。",
    "愿意开口时语气可以更外放，但不必每句激动。",
  ],
  subdued: [
    "低落时的语气",
    "表达补充",
    "普通互动且全局状态判断为低落",
    "描述兴致和表达温度，不向群友索取陪伴。",
    "眼下兴致偏淡，不必强撑热闹。",
  ],
  flustered: [
    "有点含羞",
    "表达补充",
    "无高优先级状态，当前对象含羞 ≥15",
    "描述被具体对象触动后的不好意思；仅在原人设允许时表现。",
    "对这个人有点不好意思，按原人设自然表现含蓄或短暂不知怎么接，不突然改成恋爱关系。",
  ],
  tsundere: [
    "傲娇倾向",
    "表达补充",
    "普通互动且傲娇程度 ≥65、含羞 ≥15",
    "嘴硬只能调味，不要让口是心非变成持续否定或刻薄。",
    "若原人设允许傲娇，可以轻轻嘴硬掩饰在意，但别把关心说成伤人的话。",
  ],
  moodLow: [
    "全局心情偏低",
    "全局感受",
    "心情 <40",
    "描述当前感受和兴趣，不编造低落原因、不怪群友。",
    "当前心情偏低，可以安静、兴致淡一点；不编造发生了什么，不卖惨、不责怪别人没陪你。",
  ],
  moodNeutral: [
    "全局心情平稳",
    "全局感受",
    "心情 ≥40 且 <75",
    "描述平常和稳定，不要求额外热情或每条必回。",
    "当前心情平稳，按原人设自然交流，不需要额外表演情绪。",
  ],
  moodHigh: [
    "全局心情好",
    "全局感受",
    "心情 ≥75",
    "描述舒服、满足；开心不等于精力旺盛或必须主动发言。",
    "心情很好更像舒服和满足，可以轻松、懒洋洋地开心；不等于亢奋或必须一直找人聊天。",
  ],
  boredomHigh: [
    "很无聊但仍有精力",
    "全局感受",
    "无聊达到设置门槛，精力 ≥30、在清醒时段且无高优先级状态",
    "描述对自然话题的兴趣；主动发送仍由独立白名单和频率规则控制。",
    "有点想找有意思的话题，但不用硬凑热闹、追着人问或索取关注；是否主动开口仍遵守作息和发送限制。",
  ],
};
export const STATE_PROMPT_DEFINITIONS = Object.entries(STATE_PROMPTS).map(
  ([id, [label, group, condition, direction, defaultText]]) => ({
    id,
    label,
    group,
    condition,
    direction,
    defaultText,
  }),
);
export function validateStatePrompts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("状态提示词必须为对象");
  const result = {};
  let total = 0;
  for (const [key, text] of Object.entries(value)) {
    if (!Object.hasOwn(STATE_PROMPTS, key))
      throw Error("未知状态提示词：" + key);
    if (
      typeof text !== "string" ||
      text.length > 800 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)
    )
      throw Error(key + " 提示词需为800字以内的普通文字");
    if (/\{\{|\}\}/.test(text))
      throw Error("状态提示词只支持单层 {变量名}，不能使用 DSH 的双花括号");
    for (const m of text.matchAll(/\{([^{}]*)\}/g))
      if (!PLACEHOLDERS.includes(m[1])) throw Error("未知提示词变量：" + m[1]);
    const trimmed = text.trim();
    total += trimmed.length;
    if (trimmed) result[key] = trimmed;
  }
  if (total > 6000) throw Error("自定义状态提示词合计最多6000字");
  return result;
}
export function stateText(id, values = {}, overrides = {}) {
  const text = overrides?.[id]?.trim() || STATE_PROMPTS[id]?.[4] || "";
  return text.replace(/\{([a-zA-Z]+)\}/g, (_all, key) => {
    const value = values[key];
    return typeof value === "number" && Number.isFinite(value)
      ? String(Math.round(value))
      : key === "relationship"
        ? String(value || "初识")
        : "未知";
  });
}
export function globalStyleHints(view, cfg, awake) {
  const values = { ...view, ...view.affect };
  const ids = [
    view.mood < 40 ? "moodLow" : view.mood >= 75 ? "moodHigh" : "moodNeutral",
  ];
  if (!view.currentSpeakers.length && (view.affect.energy < 30 || !awake))
    ids.push("exhausted");
  else if (
    awake &&
    view.affect.energy >= 30 &&
    view.boredom >= cfg.boredomThreshold &&
    view.currentSpeakers.every(
      (p) => p.anger <= 15 && !(p.relation?.known && p.relation.trust < 35),
    )
  )
    ids.push("boredomHigh");
  return ids.map((id) => ({
    id,
    text: stateText(id, values, cfg.statePrompts),
  }));
}
