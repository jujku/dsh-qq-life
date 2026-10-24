window.__ModuleLoader__.load({
  id: "qq-life",
  factory: (require) => {
    const React = require("react");
    return {
      inject: ["slots"],
      apply(ctx) {
        const slots = ctx.get("slots");
        slots.inject("settings.section", () =>
          slots.register(
            {
              name: "settings.section",
              id: "qq-life",
              order: 26,
              label: "QQ Life 状态",
            },
            () =>
              React.createElement("iframe", {
                title: "QQ Life 情绪与关系",
                src: "/qq-life-panel",
                style: {
                  border: 0,
                  width: "100%",
                  height: "min(76vh, 800px)",
                  minHeight: "470px",
                  borderRadius: "12px",
                },
              }),
          ),
        );
      },
    };
  },
});
