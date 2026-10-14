// OpenRouter 프록시: 브라우저에는 API 키를 노출하지 않고 서버에서만 호출합니다.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const SYSTEM_PROMPT =
  "당신은 친절하고 정확한 한국어 AI 어시스턴트입니다. 모르는 것은 모른다고 답하세요.";
const MAX_HISTORY = 20;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export async function POST(request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return json(500, { error: "서버에 OPENROUTER_API_KEY 환경변수가 설정되지 않았습니다." });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "잘못된 요청 형식입니다." });
  }

  const messages = Array.isArray(body?.messages)
    ? body.messages
        .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
        .slice(-MAX_HISTORY)
        .map(({ role, content }) => ({ role, content: content.slice(0, 8000) }))
    : [];
  if (!messages.length) return json(400, { error: "메시지가 비어 있습니다." });

  const upstream = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "http-referer": process.env.SITE_URL || "https://vercel.app",
      "x-title": "Nemotron Chatbot",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    let message = `OpenRouter 오류 (${upstream.status})`;
    try {
      message = JSON.parse(detail)?.error?.message || message;
    } catch {}
    if (upstream.status === 429) message = "무료 모델 요청 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.";
    return json(upstream.status, { error: message });
  }

  // OpenRouter의 SSE 스트림을 그대로 전달
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}
