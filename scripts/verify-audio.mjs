import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readPcmWav, writePcmWav } from '../lib/server/audio.ts';
const file=process.argv[2];if(!file)throw new Error('Pass a WAV file. Uses live transcription and incurs provider charges.');
const original=readPcmWav(new Uint8Array(readFileSync(file)));
if(original.bits!==16)throw new Error('Expected 16-bit PCM');
const source=new DataView(original.pcm.buffer,original.pcm.byteOffset,original.pcm.byteLength);
const total=Math.floor(original.pcm.length/(original.channels*2)*16000/original.sampleRate);
const recognized=[];
for(let from=0;from<total;from+=50*16000){
  const length=Math.min(50*16000,total-from);const pcm=new Uint8Array(length*2);const target=new DataView(pcm.buffer);
  for(let i=0;i<length;i++){const index=Math.floor((from+i)*original.sampleRate/16000);target.setInt16(i*2,source.getInt16(index*original.channels*2,true),true);}
  const wav=writePcmWav({sampleRate:16000,channels:1,bits:16,pcm});
  const r=await fetch('http://127.0.0.1:5173/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioBase64:Buffer.from(wav).toString('base64'),mimeType:'audio/wav'}),signal:AbortSignal.timeout(75000)});
  const data=await r.json();if(!r.ok)throw new Error(data.error?.code||'ASR_FAILED');recognized.push(data.text);
}
const transcript=recognized.join(' ');
const metadata=JSON.parse(readFileSync(file.replace(/\.wav$/,'.json'),'utf8'));
const words=s=>s.toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter(Boolean);
const expected=words(metadata.script);const heard=words(transcript);let row=Array.from({length:heard.length+1},(_,i)=>i);
for(let i=1;i<=expected.length;i++){const next=[i];for(let j=1;j<=heard.length;j++)next[j]=Math.min(row[j]+1,next[j-1]+1,row[j-1]+(expected[i-1]===heard[j-1]?0:1));row=next;}
const result={file,duration:total/16000,expectedWords:expected.length,recognizedWords:heard.length,wordErrorRate:row[heard.length]/expected.length,transcript};
mkdirSync('work',{recursive:true});writeFileSync(`work/${metadata.scenario||'live'}-audio-verification.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,transcript:transcript.slice(0,160)+'…'}));
