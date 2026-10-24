# 上传 GitHub 与发版

仓库名建议 `dsh-qq-life`，包名仍是 `qq-life`，用于保持 DSH bundle 和旧数据兼容。不要从个人运行目录直接整目录上传，使用这个独立仓库。

首次上传时，在自己的 GitHub 账号创建空仓库。将独立源码上传，不上传解压后的用户配置、node_modules、私人存档。可直接使用 GitHub 网页上传文件，或在此目录配置自己的 Git remote 后 push。

没有 GitHub Release 时，访客可以使用仓库的 Code → Download ZIP 下载并安装。仓库包含 CI 和发版工作流；推送与 package.json 对应的版本标签（例如 v1.6.0）后，GitHub Actions 会先运行离线测试，再创建 Release 并附上安装用 tgz。工作流只使用当前仓库的 GITHUB_TOKEN，不需要在插件里放个人令牌。

本地发版检查：

```sh
npm test
npm run check
npm pack
```

检查 tgz 内只有插件代码和公开文档；源代码 ZIP 则额外包含测试和 GitHub 工作流。README 不要宣称未实际验证过的 DSH 版本、QQ 框架或模型效果。
