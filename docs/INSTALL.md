# 安装、Docker 与迁移

## 路径设置优先级

DSH bundle 插件选项支持 `bridgeRoot` 和 `dataDir`，都应使用绝对路径。也可设置：

| 变量                | 作用                                         |
| ------------------- | -------------------------------------------- |
| QQ_BRIDGE_ROOT      | qq-bridge 根目录，包含 config.json 和 state/ |
| QQ_LIFE_DATA_DIR    | 本插件独立数据目录                           |
| DSH_HOME            | DSH 实际使用的数据根目录                     |
| DSH_INSTALL_MODULES | DSH 注入的宿主模块目录，通常不必自行设置     |

桥接路径优先级：插件选项 → QQ_BRIDGE_ROOT → 数据目录/connection.json → 检测安装于桥接 plugins/ 下的旧布局。

数据路径优先级：插件选项 → QQ_LIFE_DATA_DIR → DSH_HOME/qq-life → 用户目录/.dsh/qq-life。

自定义数据目录时，安装工具与启动 DSH 的环境要一致。不要将数据目录设置成桥接根目录或桥接 state/ 本身。

## 手动接入

有自己的 DSH 配置管理流程时，不必运行安装工具：

1. 将插件目录作为 profile 的本地 `link:` 依赖注册为 `qq-life`，并让 profile/node_modules/qq-life 正确链接该目录。
2. 将 `qq-life` 加到 `package.json` 的 `dsh.profile.bundles` 数组，保留其他 bundle。
3. 设置 QQ_BRIDGE_ROOT，或在实际插件数据目录创建 connection.json；格式见 examples/connection.example.json。
4. 重启 DSH，检查 qq-life 注册日志和设置页。

不要把 bridge 的控制台令牌抄进插件；主动唤醒使用已有桥接配置，插件只在本机内读取它。

## Docker

安装脚本应在实际运行 DSH 的环境中执行，路径必须是容器能看到的路径。共享：

- 插件目录（只读也可；profile 的依赖链接要指向容器路径）。
- 桥接 config.json 和 state/，用于读取当前角色、会话、白名单及消息快照。
- 独立的插件数据目录，需要可写权限。

主动聊天目前使用 `http://127.0.0.1:<bridge consolePort>`。DSH 与桥接分容器时需共享网络命名空间等方式让此地址可达；本版不支持任意远程桥接 URL。不要为了方便把控制令牌或管理接口公开。

## 从自用1.4升级

1. 停止 DSH，备份旧插件和其整个数据目录。
2. 在原 profile 移除旧 qq-life bundle/依赖/链接，再安装独立版；不要同时启用两份。
3. 将旧 config.json、state.json、person-memory.json 复制到新插件数据目录；不要复制到 Git 仓库。
4. 创建 connection.json 或设置 QQ_BRIDGE_ROOT。旧版中缺少的新参数会取默认值；旧版已有的 proactiveEnabled 和群号会被保留，不会擅自关闭已有配置。
5. 如果仍需要 qq-leisure 的作息、回执和专注联动，手动开启 leisureIntegration；未开启时使用本插件的作息。
6. 重启，核对旧好感和资料，再决定是否开启模型整理。建议先保持主动聊天关闭观察。

迁移的是自己的私有数据，不是公开发布包的一部分。示例配置不应该覆盖旧存档。

## 卸载与回滚

停止 DSH，从 profile 的 bundles 数组和 dependencies 中移除 qq-life，移除指向本插件的 node_modules/qq-life 链接；或恢复安装工具生成的 profile package.json.backup-\*。

恢复旧插件时，同时恢复原 profile 的链接配置。数据目录不会被卸载自动删除，需自行保留备份。恢复状态后不要再次导入旧消息历史来重复计分。
