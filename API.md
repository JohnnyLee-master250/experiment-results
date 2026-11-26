# 当前批次数据接口

`api/v1/index.json` 的 `datasets`、`categories` 和 `models` 是本轮保留的测试集、实验和模型目录。`edition_started_at` 是新旧批次的时间边界。目录条目不代表已启动实验。

主页在 `records` 中按 `dataset`、`group` 和 `model` 读取 `count`，另从 `api/v1/cannbot-windows.json` 的 `tasks` 读取本轮 Windows CannBot 的已完成轮数。同一结果只写入一个来源。没有结果时这些数组为空，未测的单元格显示为破折号。

旧版主页、数据和接口说明位于 [archive/](archive/)。
