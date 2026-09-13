# 刚刚好的减脂计划

这是一个无需安装的多页静态小站；AI 识餐通过 Supabase Edge Function 安全调用 DeepSeek。

## 打开方式

双击 `index.html` 即可从首页开始。六个 HTML 页面通过相对链接互相跳转，请将它们与 `styles.css`、`script.js` 保持在同一文件夹中。

## 页面

- `index.html`：个人目标、核心指标与每日打卡
- `diet.html`：饮食框架、一日模板与热量分配器
- `workout.html`：3 / 4 / 5 天训练计划
- `progress.html`：晨重记录、趋势图和 7 日均值建议
- `takeout.html`：外卖筛选、搭配方法与可复制备注
- `ai-food.html`：餐食拍照或上传、图片压缩、AI 营养识别与结果确认

当前版本已支持将确认后的餐食热量和蛋白质记入今日仪表盘，自动计算剩余目标并生成下一餐建议；也支持删除错误餐食记录和标记今日训练完成。

AI 识餐所需的 Supabase Function URL 和 Publishable Key 配置在 `script.js` 顶部。DeepSeek API Key 只应保存在 Supabase Secrets 中，不能写入网页文件。

餐食照片会在浏览器中压缩后发送给 AI 识别；打卡、训练频率、确认后的餐食和体重记录仍只保存在当前浏览器的本地存储中。清除浏览器站点数据后，记录也会被清除。

本计划仅供日常健康管理参考，不能替代医疗或个体化营养建议。
