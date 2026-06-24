// AI 对话代理（Netlify v2 函数，支持响应流式）。
// API key 与系统提示词都只在服务器端；把 DeepSeek 的 SSE 流原样转发给前端。
import sysprompt from '../../systemPrompt.js';
const { buildSystemMessages } = sysprompt;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  let body;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400, headers: cors }); }

  const { messages, name, date } = body;
  if (!messages || !Array.isArray(messages)) {
    return new Response('Missing messages', { status: 400, headers: cors });
  }

  const apiKey = process.env.DEEPSEEK_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { message: '服务器未配置 DEEPSEEK_KEY 环境变量' } }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // 静态提示词在前（可被 DeepSeek 缓存的固定前缀），姓名/日期紧随其后
  const fullMessages = [...buildSystemMessages(name, date), ...messages];

  const upstream = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 700, temperature: 0.7, stream: true, messages: fullMessages }),
  });

  if (!upstream.ok || !upstream.body) {
    const t = await upstream.text().catch(() => '');
    return new Response(JSON.stringify({ error: { message: `上游错误 ${upstream.status}: ${t.slice(0, 200)}` } }),
      { status: upstream.status || 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // 直接把上游 SSE 流转发给前端
  return new Response(upstream.body, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
};
