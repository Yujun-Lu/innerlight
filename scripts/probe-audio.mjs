import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { serverConfig } from '../lib/server/config.ts';
import { ttsPayload, readPcmWav, writePcmWav } from '../lib/server/audio.ts';
const c=serverConfig(parseEnv(readFileSync('.dev.vars','utf8')));
try {
  const response=await fetch(c.ttsUrl,{method:'POST',headers:{Authorization:`Bearer ${c.ttsKey}`,'Content-Type':'application/json'},body:JSON.stringify(ttsPayload('You can leave a little space for yourself. The care you offer can include you, too.',c.ttsModel)),signal:AbortSignal.timeout(180000)});
  const data=await response.json();
  console.log(JSON.stringify({stage:'generation',status:response.status,keys:Object.keys(data),outputKeys:Object.keys(data.output||{}),audioKeys:Object.keys(data.output?.audio||{}),error:data.code||data.error?.code||null}));
  if(!data.output?.audio?.url) process.exit(1);
  const url=new URL(data.output.audio.url);
  console.log(JSON.stringify({stage:'url',protocol:url.protocol,hostname:url.hostname}));
  if(url.protocol==='http:' && /(?:^|\.)aliyuncs\.com$/.test(url.hostname))url.protocol='https:';
  const downloaded=await fetch(url,{signal:AbortSignal.timeout(45000)});
  const bytes=new Uint8Array(await downloaded.arrayBuffer());
  console.log(JSON.stringify({stage:'download',status:downloaded.status,bytes:bytes.length,signature:new TextDecoder().decode(bytes.slice(0,12))}));
  const wav=readPcmWav(bytes); mkdirSync('work',{recursive:true});writeFileSync('work/voice-probe.wav',writePcmWav(wav));
  console.log(JSON.stringify({stage:'validated',sampleRate:wav.sampleRate,channels:wav.channels,bits:wav.bits,duration:wav.pcm.length/(wav.sampleRate*wav.channels*wav.bits/8)}));
} catch(error) { console.log(JSON.stringify({stage:'failed',code:error.code||error.name}));process.exitCode=1; }
