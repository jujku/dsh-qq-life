import { importHost } from "./host.js";
import { offPeak, offPeakRemaining, MIN } from "./schedule.js";

// Lazy resolution means deterministic emotion/relations work without an LLM service.
// Reuse the host's credential service; never read, save or accept an API key here.
export function createGenerator(ctx, configNow) {
  return async ({ system, data, learning = true, maxTokens = 900, signal }) => {
    const cfg = configNow();
    if (!cfg.semanticMemoryEnabled) throw Error("模型整理资料未启用");
    const llm = ctx.llm || ctx.get?.("llm");
    if (!llm?.stream)
      throw Error("DSH llm 服务未启用，本地情绪与资料采集仍可使用");
    const now = Date.now();
    if (learning && (!offPeak(now) || offPeakRemaining(now) < 2 * MIN))
      throw Error("高峰边界暂停模型整理");
    const { BlockAssembler, createUserMessage } = await importHost(
      "@deepseek-ai/dsh-llm",
    );
    const timeout = learning
      ? Math.min(90000, offPeakRemaining(now) - 5000)
      : 45000;
    const abort = AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(signal ? [signal] : []),
    ]);
    const assembler = new BlockAssembler();
    for await (const chunk of llm.stream({
      provider: cfg.summaryProvider,
      model: cfg.summaryModel,
      reasoningEffort: "off",
      system,
      messages: [
        createUserMessage({
          content: [{ type: "text", text: JSON.stringify(data) }],
          source: { kind: "qq-life" },
        }),
      ],
      maxTokens,
      signal: abort,
    })) {
      abort.throwIfAborted();
      if (learning && !offPeak(Date.now()))
        throw Error("进入暂停时段，停止模型整理");
      assembler.push(chunk);
    }
    if (assembler.finish?.kind !== "stop")
      throw Error("模型整理未正常完成：" + assembler.finish?.kind);
    const text = assembler
      .blocks()
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      value: JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")),
      usage: assembler.usage || null,
    };
  };
}
