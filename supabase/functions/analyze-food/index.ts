import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const jsonResponse = (body: unknown, status = 200, extraHeaders: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders },
  });

const systemPrompt = `你是一名营养分析助手。识别餐食图片并严格只返回 JSON，不要返回 Markdown 或解释文字。结构：
{
  "mealName":"餐食名称",
  "items":[{"name":"食物名称","amount":"估算份量","calories":0,"protein":0,"carbs":0,"fat":0}],
  "total":{"calories":0,"protein":0,"carbs":0,"fat":0},
  "confidence":"medium",
  "note":"结果仅供参考"
}
所有营养值必须是非负数字；confidence 只能是 high、medium、low；无法准确判断时合理估算。`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "仅支持 POST 请求" }, 405);

  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const secretKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const deepSeekKey = Deno.env.get("DEEPSEEK_API_KEY") ?? "";
  const model = Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-flash";
  const dailyLimit = Math.max(1, Math.min(500, Number(Deno.env.get("AI_DAILY_LIMIT") ?? 20)));

  if (!supabaseUrl || !publishableKey || !secretKey || !deepSeekKey) {
    console.error(JSON.stringify({ requestId, event: "missing_config" }));
    return jsonResponse({ error: "服务配置不完整", requestId }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse({ error: "请先登录后再使用 AI 识餐", requestId }, 401);

  const authClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  const user = userData.user;

  if (userError || !user) {
    return jsonResponse({ error: "登录已过期，请重新登录", requestId }, 401);
  }

  const writeLog = async (
    status: "success" | "rejected" | "failed",
    errorCode?: string,
    providerStatus?: number,
    detail?: string,
  ) => {
    const safeDetail = detail ? detail.slice(0, 1000) : null;
    const { error } = await admin.from("ai_request_logs").insert({
      request_id: requestId,
      user_id: user.id,
      status,
      error_code: errorCode ?? null,
      provider_status: providerStatus ?? null,
      latency_ms: Date.now() - startedAt,
      detail: safeDetail,
    });
    if (error) console.error(JSON.stringify({ requestId, event: "monitor_write_failed", detail: error.message }));
  };

  const { data: quotaRows, error: quotaError } = await admin.rpc("consume_ai_quota", {
    p_user_id: user.id,
    p_limit: dailyLimit,
  });
  const quota = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows;

  if (quotaError) {
    await writeLog("failed", "quota_check_failed", undefined, quotaError.message);
    return jsonResponse({ error: "暂时无法检查识别额度", requestId }, 503);
  }
  if (!quota?.allowed) {
    await writeLog("rejected", "daily_limit_reached");
    return jsonResponse(
      { error: `今天的 AI 识餐次数已用完（${quota?.quota ?? dailyLimit} 次）`, requestId, quota },
      429,
      { "Retry-After": "3600" },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    await writeLog("rejected", "invalid_json");
    return jsonResponse({ error: "请求 JSON 格式无效", requestId, quota }, 400);
  }

  const imageDataUrl = String(body.imageDataUrl ?? body.imageUrl ?? "").trim();
  const isPublicUrl = /^https?:\/\//i.test(imageDataUrl);
  const isBase64Image = /^data:image\/(?:jpeg|jpg|png|gif|webp);base64,/i.test(imageDataUrl);
  if ((!isPublicUrl && !isBase64Image) || imageDataUrl.length > 8_000_000) {
    await writeLog("rejected", imageDataUrl.length > 8_000_000 ? "image_too_large" : "invalid_image");
    return jsonResponse({ error: imageDataUrl.length > 8_000_000 ? "图片太大，请压缩后重试" : "图片格式无效", requestId, quota }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const providerResponse = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${deepSeekKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [
            { type: "text", text: "请分析这张餐食图片。" },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ] },
        ],
      }),
    });

    if (!providerResponse.ok) {
      const detail = await providerResponse.text();
      await writeLog("failed", "provider_error", providerResponse.status, detail);
      return jsonResponse({ error: "餐食识别服务调用失败", requestId, quota }, 502);
    }

    const providerResult = await providerResponse.json();
    const content = providerResult?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      await writeLog("failed", "empty_provider_result");
      return jsonResponse({ error: "餐食识别结果无效", requestId, quota }, 502);
    }

    let analysis: unknown;
    try { analysis = JSON.parse(content); }
    catch {
      await writeLog("failed", "invalid_provider_json", providerResponse.status, content);
      return jsonResponse({ error: "餐食识别结果格式无效", requestId, quota }, 502);
    }

    if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
      await writeLog("failed", "invalid_provider_shape");
      return jsonResponse({ error: "餐食识别结果格式无效", requestId, quota }, 502);
    }

    await writeLog("success");
    console.log(JSON.stringify({ requestId, event: "success", userId: user.id, latencyMs: Date.now() - startedAt }));
    return jsonResponse({ result: analysis, requestId, quota }, 200);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    const code = timedOut ? "provider_timeout" : "unexpected_error";
    const detail = error instanceof Error ? error.message : String(error);
    await writeLog("failed", code, undefined, detail);
    return jsonResponse({ error: timedOut ? "餐食识别服务响应超时" : "餐食识别服务暂时不可用", requestId, quota }, timedOut ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
});

