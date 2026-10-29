import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { samples } from '../lib/samples.ts';
import { serverConfig } from '../lib/server/config.ts';
import { synthesize } from '../lib/server/audio.ts';

const env = parseEnv(readFileSync('.dev.vars', 'utf8'));
const config = serverConfig(env);
mkdirSync('public/audio', { recursive: true });
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(samples)) {
  if (!samples[id]) throw new Error('Unknown sample');
  const file = `public/audio/${id}.wav`;
  if (existsSync(file) && existsSync(`public/audio/${id}.json`)) {
    const previous = JSON.parse(readFileSync(`public/audio/${id}.json`, 'utf8'));
    if (previous.script === samples[id].meditation.script) { console.log(JSON.stringify({id,status:'cached'})); continue; }
  }
  try {
    const result = await synthesize(samples[id].meditation.script, config, new AbortController().signal);
    writeFileSync(file, result.bytes);
    writeFileSync(`public/audio/${id}.json`, JSON.stringify({scenario:id,title:samples[id].meditation.title,duration:result.duration,segments:result.segments,source:'Prewritten fictional scenario · AI-generated narration',script:samples[id].meditation.script},null,2));
    console.log(JSON.stringify({id,status:'generated',duration:result.duration,segments:result.segments,bytes:result.bytes.length}));
  } catch (error) {
    console.log(JSON.stringify({id,status:'failed',code:error.code || 'SYNTHESIS_FAILED'}));
    process.exitCode=1; break;
  }
}
