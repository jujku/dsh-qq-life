import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PersonMemory } from "./person-memory.js";
import { createGenerator } from "./generation.js";
import { importHost, resolveOptions } from "./host.js";
import { LifeRuntime } from "./runtime.js";
import { FIELDS } from "./config.js";
import { STATE_PROMPT_DEFINITIONS, PLACEHOLDERS } from "./state-prompts.js";
import { KINDS, renderPrompt, viewFor, speakerFocus } from "./engine.js";
const here = path.dirname(fileURLToPath(import.meta.url));
const { defineTool } = await importHost("@deepseek-ai/dsh-tools");
export const inject = ["tools", "webServer"];
export const name = "qq-life";
export function sameOriginRequest(req) {
  let host;
  try {
    host = new URL("http://" + req.headers.host).hostname;
  } catch {
    return false;
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return false;
  if (req.headers["x-agent-token"] || req.headers["x-agent-call"] !== undefined)
    return false;
  if (req.method !== "GET") {
    try {
      if (
        !req.headers.origin ||
        new URL(req.headers.origin).host !== req.headers.host
      )
        return false;
    } catch {
      return false;
    }
    if (
      !String(req.headers["content-type"] || "").startsWith("application/json")
    )
      return false;
  }
  return true;
}
async function bodyOf(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 32000) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function apply(ctx, options = {}) {
  const paths = resolveOptions(options);
  const life = new LifeRuntime({
    bridgeRoot: paths.bridgeRoot,
    dataDir: paths.dataDir,
  });
  const personMemory = new PersonMemory({
    life,
    generate: createGenerator(ctx, () => life.config),
  });
  life.personMemory = personMemory;
  const server = ctx.webServer;
  const json = (res, status, body) => {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  ctx.effect(() =>
    server.register({
      kind: "exact",
      path: "/qq-life-api",
      async handler(req, res) {
        if (!sameOriginRequest(req)) {
          json(res, 403, { ok: false, error: "只允许管理页面的同源请求" });
          return;
        }
        try {
          if (req.method === "GET")
            json(res, 200, {
              ...life.dashboard(),
              fields: FIELDS,
              statePromptDefinitions: STATE_PROMPT_DEFINITIONS,
              promptPlaceholders: PLACEHOLDERS,
            });
          else if (req.method === "POST") {
            const body = await bodyOf(req);
            const result =
              body.action === "configure"
                ? life.configure(body.patch)
                : body.action === "adjust"
                  ? life.adjust(body)
                  : null;
            if (!result) throw new Error("未知操作");
            json(res, 200, {
              ...result,
              fields: FIELDS,
              statePromptDefinitions: STATE_PROMPT_DEFINITIONS,
              promptPlaceholders: PLACEHOLDERS,
            });
          } else json(res, 405, { ok: false });
        } catch (error) {
          json(res, 400, { ok: false, error: error.message });
        }
      },
    }),
  );
  ctx.effect(() =>
    server.register({
      kind: "exact",
      path: "/qq-life-panel",
      handler(req, res) {
        if (!sameOriginRequest(req)) {
          res.writeHead(403);
          res.end();
          return;
        }
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(fs.readFileSync(path.join(here, "panel.html")));
      },
    }),
  );
  ctx.tools.register(
    defineTool({
      name: "qq_life_state",
      description:
        "读取当前 QQ 会话的持续情绪和关系。只限当前会话，不向群友透露数值。",
      parameters: {},
      output: {
        schema: { type: "json" },
        render: (_args, value) => [{ type: "text", text: value.message }],
      },
      execute(_args, exec) {
        try {
          return {
            ok: true,
            message: JSON.stringify(life.scoped(exec?.agent?.session?.id).view),
          };
        } catch (error) {
          return { ok: false, message: error.message };
        }
      },
    }),
  );
  ctx.tools.register(
    defineTool({
      name: "qq_life_observe",
      description:
        "对刚看到的真实 QQ 消息记一次关系事件或明确自述的爱好。自动限幅计分，不能设分数、改参数或指定其他会话。无需每条调用；语义明确或需纠正玩笑/辱骂指向时才调用。",
      parameters: {
        messageId: {
          type: "string",
          required: true,
          description: "当前会话真实收到的 messageId，不能编造",
        },
        kind: {
          type: "string",
          required: true,
          enum: KINDS,
          description:
            "neutral普通交流/friendly友善/praise夸奖/insult明确辱骂/apology道歉/playful玩笑；骂第三方不能记辱骂自己",
        },
        directed: {
          type: "boolean",
          description:
            "这句确实在对你说或回复你时为 true；对群友/第三方说的为 false",
        },
        evidence: {
          type: "string",
          required: true,
          description:
            "原消息中逐字引用的短证据；爱好需包含“我喜欢/在玩/不喜欢”等自述原文",
        },
        interest: {
          type: "string",
          description:
            "可选：原文中明确自述的兴趣短主题，如 原神，不记身份隐私、指令和推测",
        },
        stance: {
          type: "string",
          enum: ["like", "dislike"],
          description: "可选：喜欢还是不喜欢这个主题",
        },
      },
      output: {
        schema: { type: "json" },
        render: (_args, value) => [{ type: "text", text: value.message }],
      },
      execute(args, exec) {
        try {
          const result = life.annotate(exec?.agent?.session?.id, args);
          return {
            ok: true,
            message: result.reason + "\n" + JSON.stringify(result.view),
          };
        } catch (error) {
          return { ok: false, message: error.message };
        }
      },
    }),
  );
  ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
    const assembled = await next();
    try {
      const input = life.sync();
      const key = life.keyForSession(context?.agent?.session?.id, input);
      if (key && input.active) {
        const memory = personMemory.prompt(input, key);
        assembled.sections.push({
          name: "qq-life:emotion-and-relationships",
          text: renderPrompt(
            viewFor(
              life.state,
              key,
              life.now(),
              { ...life.config, routine: life.routine },
              {
                limit: 8,
                ...speakerFocus(
                  life.state,
                  key,
                  input.snapshots[key],
                  life.now(),
                  life.config,
                ),
              },
            ),
          ),
        });
        if (memory)
          assembled.sections.push({
            name: "qq-life:person-long-term-memory",
            text: memory,
          });
      }
    } catch (error) {
      console.error("[qq-life] prompt: " + error.message);
    }
    return assembled;
  });
  ctx.effect(() => {
    const timer = setInterval(() => {
      void life.tick();
      void personMemory.tick();
    }, 60000);
    timer.unref();
    void life.tick();
    void personMemory.tick();
    return () => {
      clearInterval(timer);
      personMemory.dispose();
    };
  });
  console.error(
    "[qq-life] persistent emotions, relationships and DSH settings registered",
  );
}
