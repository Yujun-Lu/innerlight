import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const env = parseEnv(readFileSync('.dev.vars', 'utf8'));
const auth = { Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' };
try {
  const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST', headers: auth, signal: AbortSignal.timeout(45000),
    body: JSON.stringify({model: env.TEXT_MODEL || 'qwen3.8-flash', messages: [{role:'user',content:'Reply only with: connected'}], max_tokens: 20, enable_thinking: false}),
  });
  const data = await response.json();
  console.log(JSON.stringify({service:'text',status:response.status,ok:!!data.choices?.[0]?.message?.content,code:data.error?.code || data.code || null}));
} catch { console.log(JSON.stringify({service:'text',ok:false,code:'NETWORK_ERROR'})); }
