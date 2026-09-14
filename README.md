# 刚刚好的减脂计划 v2

移动端优先的多页减脂 Web App。未登录时数据保存在浏览器；登录后，餐食、体重、每日打卡、训练完成状态和常用餐食会通过 Supabase 跨设备同步。AI 识餐由受保护的 Supabase Edge Function 调用 DeepSeek。

## 页面

- `index.html`：今日热量、蛋白质、餐食与打卡仪表盘
- `diet.html`：饮食框架、一日模板与热量分配
- `workout.html`：3 / 4 / 5 天训练计划与完成记录
- `progress.html`：晨重趋势、7 日均值和过去 7 天周报
- `takeout.html`：外卖筛选、搭配方法与点单备注
- `ai-food.html`：手机拍照、AI 识餐、食物明细修改与保存
- `history.html`：餐食历史、筛选、收藏和一键复用

## 已实现能力

- 邮箱和密码注册、登录与退出
- 本地优先：不登录也可以记录
- 登录后自动合并本机与云端数据
- 餐食、体重、打卡、训练和收藏跨设备同步
- AI 接口必须使用登录用户 JWT
- 每用户每日 AI 调用上限，默认 20 次
- AI 成功、失败、耗时、错误类型和请求 ID 监控
- AI 结果按食物逐项增删、修改份量和营养
- 餐食历史搜索、餐次/日期筛选
- 常用餐食收藏与一键记入今天
- 过去 7 天平均热量、蛋白质、体重变化和训练次数
- 手机后置摄像头入口，照片处理完成后可自动识别

## 本地打开

直接打开 `index.html` 可使用本地功能。为了避免浏览器对本地文件的网络限制，登录和 AI 功能建议通过本地 HTTP 服务或部署后的 GitHub Pages 地址测试。

## Supabase 配置

### 1. 创建数据表和 RLS

在 Supabase Dashboard 的 **SQL Editor** 中执行：

```text
supabase/migrations/202609140001_sync_and_ai_security.sql
```

该脚本会创建 `meal_logs`、`weight_logs`、`daily_logs`、`favorite_meals`、`ai_usage_daily`、`ai_request_logs` 和原子限额函数 `consume_ai_quota`。

业务数据均启用 Row Level Security，登录用户只能访问自己的记录。AI 配额和监控表仅允许服务端密钥访问。

### 2. 开启邮箱登录

在 **Authentication → Sign In / Providers → Email** 中开启 Email 登录。若保留“确认邮箱”选项，新用户注册后需要先点击确认邮件再登录。

### 3. 配置 Edge Function Secrets

至少配置：

```text
DEEPSEEK_API_KEY=你的 DeepSeek 私密密钥
DEEPSEEK_MODEL=当前可用的视觉模型名称
AI_DAILY_LIMIT=20
```

`SUPABASE_URL`、Publishable Key 和服务端 Secret/Service Role Key 由 Supabase 托管环境提供。DeepSeek 私密密钥不能写入 `script.js` 或提交到 GitHub。

### 4. 部署 Edge Function

将 `supabase/functions/analyze-food/index.ts` 部署为 `analyze-food`，并保持 JWT 验证开启。对应配置已写在 `supabase/config.toml`：

```toml
[functions.analyze-food]
verify_jwt = true
```

前端通过 Supabase 登录会话的 Access Token 调用函数；未登录或令牌过期会收到 401。

### 5. 检查前端项目配置

`script.js` 顶部包含可公开的 `SUPABASE_URL`、`SUPABASE_FUNCTION_URL` 和 `SUPABASE_PUBLISHABLE_KEY`。Publishable Key 设计上可放在前端，数据安全由用户 JWT 和 RLS 保证。不要在前端放 Secret Key、Service Role Key 或 DeepSeek API Key。

## AI 异常监控

在 Supabase SQL Editor 中可使用以下只读查询：

```sql
select status, error_code, count(*) as requests,
       round(avg(latency_ms)) as avg_latency_ms
from public.ai_request_logs
where created_at >= now() - interval '7 days'
group by status, error_code
order by requests desc;
```

```sql
select usage_date, count(*) as active_users, sum(request_count) as requests
from public.ai_usage_daily
where usage_date >= current_date - 7
group by usage_date
order by usage_date desc;
```

客户端错误响应带有 `requestId`，可以用它在 `ai_request_logs` 中定位单次失败。

## 数据同步规则

- 餐食、体重和收藏按客户端 ID 或日期合并，更新时间较新的版本优先。
- 打卡和训练状态以每日 `updated_at` 解决跨设备冲突。
- 操作先写入本机，再排队写入云端；网络失败时本机记录不丢失。
- 点击顶部“已同步”可以查看账号并手动触发同步。
- 退出登录不会清除本机数据。

## 发布

静态页面可以继续使用 GitHub Pages：

<https://shuaigazhou-tech.github.io/fatloss-plan-demo/>

更新仓库中的 HTML、CSS、JavaScript 和 `supabase/` 配置文件后，GitHub Pages 会重新发布前端。数据库迁移和 Edge Function 需要单独在 Supabase 部署。

## 安全说明

- AI 识别和营养数据仅供日常参考，不能代替医生或注册营养师。
- 正式推广前应补充隐私政策、账号注销和数据导出能力。
- 建议为异常率和 DeepSeek 费用设置 Supabase 日志告警或外部监控。
