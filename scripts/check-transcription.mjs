import { readFileSync } from 'node:fs';
import { readPcmWav, writePcmWav } from '../lib/server/audio.ts';
const original=readPcmWav(new Uint8Array(readFileSync(process.argv[2]||'work/voice-probe.wav')));
if(original.bits!==16)throw new Error('Expected 16-bit PCM');
const source=new DataView(original.pcm.buffer,original.pcm.byteOffset,original.pcm.byteLength);
const length=Math.min(10*16000,Math.floor(original.pcm.length/(original.channels*2)*16000/original.sampleRate));
const pcm=new Uint8Array(length*2);const target=new DataView(pcm.buffer);
for(let i=0;i<length;i++){const index=Math.floor(i*original.sampleRate/16000);target.setInt16(i*2,source.getInt16(index*original.channels*2,true),true);}
const wav=writePcmWav({sampleRate:16000,channels:1,bits:16,pcm});
const r=await fetch('http://127.0.0.1:5173/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioBase64:Buffer.from(wav).toString('base64'),mimeType:'audio/wav'}),signal:AbortSignal.timeout(75000)});
const data=await r.json();console.log(JSON.stringify({status:r.status,...data}));if(!r.ok)process.exitCode=1;
