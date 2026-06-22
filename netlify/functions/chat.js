// AI 对话代理 —— DeepSeek 专用。
// API key 与系统提示词都只存在此处（服务器端），前端不可见。
const { buildSystemPrompt } = require('../../systemPrompt.js');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { messages, name } = body;
  if (!messages || !Array.isArray(messages)) {
    return { statusCode: 400, body: 'Missing messages' };
  }

  // 系统提示词在服务器端注入，前端只发送用户/助手的对话轮次
  const fullMessages = [
    { role: 'system', content: buildSystemPrompt(name) },
    ...messages,
  ];

  const apiBase = 'https://api.deepseek.com';
  const apiKey  = process.env.DEEPSEEK_KEY;
  const model   = 'deepseek-chat';

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: '服务器未配置 DEEPSEEK_KEY 环境变量' } }),
    };
  }

  try {
    const resp = await fetch(`${apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, max_tokens: 2048, temperature: 0.7, messages: fullMessages }),
    });

    const data = await resp.json();
    return {
      statusCode: resp.status,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: { message: e.message } }),
    };
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
