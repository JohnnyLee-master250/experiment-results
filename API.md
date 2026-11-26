# 实验数据接口

主页与旧版使用相同的 v1 渲染器。入口为 `api/v1/index.json`，每个数据文件的 `updated_at` 与入口对应。各测试集、KL 和 CannBot 的 `runs` 保存实际记录，`slots` 定义待测模型和方法，用于在空页面显示选择项。配置项不计入实验结果。Windows 批次通过 `api/v1/cannbot-windows.json` 单独发布。

旧数据与当时的接口说明见 [旧版归档](archive/)。
