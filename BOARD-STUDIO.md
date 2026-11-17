# 比赛展板工作台

基于 OpenPencil，开发分支 `feat/board-studio`。

第一批功能：编辑器右侧提供展板面板；新建 A3 横竖版原生画板；选择文字、分组或整板后批量换字体（保留其他文字属性，跳过锁定内容）；通过原有撤销恢复；导出选中展板 PNG/JPG。新建画板为 3508 × 4961 像素，横版反转。导出使用当前画板的实际尺寸，不靠 DPI 标签放大。

字体选择、模型设置、对话设计、保存、图层和共同编辑沿用 OpenPencil。新增展板设计指令要求中文使用真实文字层，保留卡片内部元素，编辑前读取最新文档。

尚在开发：独立生图/图片编辑 API、参考图生成多个候选、素材版本管理、字体文件导入、PDF 印前验证。现有模型设置入口用于设计对话，不代表生图 API 已接通。

桌面交付：GitHub Actions 的 `Board Studio Windows` 工作流从当前开发分支构建 Windows x64 安装包，产物名为 `Board-Studio-Windows-x64`。安装后从开始菜单打开 **Board Studio**，新建文件即可看到编辑器右侧的“展板工作台”。应用内嵌编辑器，不需要启动本地网页服务。程序使用独立应用标识，关闭上游自动更新；系统凭据存储暂时沿用上游实现。

使用步骤：新建 A3 横版或竖版 → 放入图片并添加真实文字图层 → 选择文字、分组或整板，选择字体并点击“应用字体” → 点击“导出 PNG/JPG”。新建 A3 竖版输出为 3508 × 4961 px，对应 A3 的 300 ppi 像素量；当前尚未写入打印 DPI 元数据。保存可编辑源文件沿用原有文件菜单。模型设置入口用于配置设计对话 API，独立生图接口仍在开发。

Windows 本地构建需 Bun、Node.js、Rust（版本见 `rust-toolchain.toml`）、MSVC C++ 构建工具和 `cargo-about`。依次运行：

```powershell
bun install --frozen-lockfile
bun run build:packages
bun tools/release/release-packages/src/cli.ts notices
bun run generate:icons --target desktop
bun run generate:tauri-menu
bunx vite build
Set-Location desktop
node ../node_modules/@tauri-apps/cli/tauri.js build --config tauri.board-studio.conf.json --bundles nsis
```

安装包输出到仓库根目录下 `target/release/bundle/nsis/`。首次构建会从源码编译 HTML 引擎的 WebAssembly 模块。

仓库：https://github.com/7YYYB/open-pencil
