# 维护入口

`state-prompts.js` 管理16种可编辑表达模板、变量与格式校验；`engine.js` 保留触发条件和优先级。写法见 STATE_PROMPTS.md，接入脱离方案见 DECOUPLING_OPTIONS.md（仅调研）。

| 文件                        | 职责                                                     |
| --------------------------- | -------------------------------------------------------- |
| index.js / host.js          | DSH 生命周期、管理路由、会话工具、路径和宿主模块解析     |
| config.js                   | 所有面板可编辑参数和校验                                 |
| runtime.js                  | 桥接快照、白名单、存档和主动唤醒；唯一情绪存档写入者     |
| engine.js / affect.js       | 确定性情绪、当前对象聚焦和动态提示                       |
| relationships.js            | 交往合并、去重、长期关系与衰减                           |
| person-memory.js            | 资料采集、检索、来源校验、删除纠正和批次整理             |
| schedule.js / generation.js | 本地批次整理时段、DSH 模型调用适配；不依赖 qq-leisure    |
| routine.js                  | UTC+8 作息；保留旧数据兼容的日程辅助函数，不提供说说发送 |
| client.js / panel.html      | DSH 设置页入口与管理界面                                 |
| scripts/install.mjs         | 本地 bundle 安装、备份和目录链接                         |

接入其他 QQ 框架需要实现独立桥接适配层，不能只换 OneBot 地址。本版明确依赖 qq-bridge 的运行文件和唤醒协议。

测试使用虚构用户、临时目录、可控时间与假模型，重点检查长期计分、私聊隔离、证据和作用域、重启恢复、安装回滚、默认开关与宿主生命周期。离线测试不等于实际模型风格已得到普遍验证。
