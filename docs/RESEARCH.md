# GitHub 调研与复用选择

调研日期：2026-10-15。Stars 是当次 GitHub 页面展示的约数，会持续变化。

| 项目 | Stars 约数 | 许可证 | 与 Workbench 的关系 |
|---|---:|---|---|
| [Zotero](https://github.com/zotero/zotero) | 15k | 默认 AGPL-3.0，具体文件可能不同 | 资料库和阅读标注工作流很接近；参考交互，不复制其代码 |
| [Koodo Reader](https://github.com/koodo-reader/koodo-reader) | 28.5k | AGPL-3.0 | 书架、进度、阅读器很接近；参考功能组织，不复制代码或素材 |
| [Sioyek](https://github.com/ahrm/sioyek) | 9.9k | GPL-3.0 | 面向教材与论文的阅读器；参考阅读需求，不复制代码 |
| [PDF.js](https://github.com/mozilla/pdf.js) | 53.9k | Apache-2.0 | 实际复用发行包：渲染、文字选择、缩略图与配套样式 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 8.7k | MIT | 实际复用：PDF 文档解析与标准注释写回 |
| [Electron](https://github.com/electron/electron) | 123.3k | MIT，Chromium 有第三方声明 | 实际复用：Windows 桌面窗口、文件选择、受限 IPC、回收站 |
| [Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF) | 未单独核实 | 根 LICENSE 有目录例外，非全仓统一 MIT | 功能侧重 PDF 工具集，不适合直接作为课程桌面应用底座，未复制代码 |

选择独立的课程与文件管理层，加成熟阅读基础组件，避免引入整套文献引用、云同步、电子书解析或服务器功能。GPL/AGPL 项目并非不能复用；本版没有复制它们的代码，因此不将这些整套项目作为依赖。实际使用的包保留原版权及许可证，源码不修改上游包，通过公开 API 集成。

## 版本与归属

确切版本见 package-lock.json。运行时 PDF.js 6.4.299、pdf-lib 1.17.1、Electron 44.7.2。依赖源码保留在 npm 官方发行包中，许可证复制到 licenses/ 并在 THIRD_PARTY_NOTICES.md 记录。Electron 的 LICENSE.electron.txt 与 LICENSES.chromium.html 随桌面发行目录提供。自己的应用代码使用 MIT。

## 安全资料

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [PDF.js Security](https://github.com/mozilla/pdf.js/security)
- [PowerPoint AutomationSecurity](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.application.automationsecurity)
- [PowerPoint Comments.Add](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.comments.add)
- [Zotero Licensing](https://www.zotero.org/support/licensing)

Stars 仅用于判断社区使用情况，不作为安全结论。安全结论以实际依赖审计、权限边界检查与测试为依据，且不是第三方渗透测试认证。
