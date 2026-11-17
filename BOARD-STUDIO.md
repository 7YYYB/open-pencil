# 比赛展板工作台

基于 OpenPencil，开发分支 feat/board-studio。

使用流程：新建或选择 A3 展板 → 填写主题与要求 → 添加参考图 → 分析参考、先做主视觉、透明标题花字或制作整板 → 在 AI 对话继续修改 → 保存可编辑文件并导出 PNG/JPG。

支持视觉的设计模型直接收到图片附件，Codex ACP 也传递图片；只在设计模型不支持视觉时使用独立视觉分析，等待最多 60 秒且可取消。

右侧“生图 API 设置”选择已配置的 OpenAI/OpenAI-compatible API 连接，填写服务商提供的图像模型 ID。沿用已保存的密钥，模型 ID 与聊天模型分别配置。服务商需要支持 /images/generations 和 /images/edits。素材生成按服务商计费；软件未内置免费生图模型。

当前生图工具供直接 API 设计聊天使用，ACP/MCP 尚未接入这个应用侧生图工具。普通素材生成独立图片层，可用画布图层或最新消息附件进行参考改图；原素材保留。标题花字请求透明 PNG 并检查透明像素；其余中文使用真实文字层与本地字体、字号和字重。生成图内部仍是像素，不是自动拆解为矢量。整板分层由模型分别生成素材和排版完成，不能保证任意参考图一键达到投稿终稿。

新建 A3 竖版为 3508 × 4961 px，横版反转。工作台“导出 PNG/JPG”按画板实际像素导出，写入 300 ppi 元数据；PNG 的整数像素/米精度对应约 299.9994 ppi。低分辨率素材不会因导出标签而获得新细节。保存可编辑源文件沿用文件菜单。

开发阶段交付 F:\freegpt6\REA\Board-Studio-Portable 免安装文件夹。只有明确发布时才生成安装包。Windows 构建通过 GitHub Actions 的 Board Studio Windows 工作流，默认 --no-bundle，产物 Board-Studio-Portable-Windows-x64。应用内嵌编辑器，无需启动网页服务。设置与缓存使用 Windows 用户数据目录。

仓库：https://github.com/7YYYB/open-pencil
