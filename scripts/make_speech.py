#!/usr/bin/env python3
"""Build optional original English prompt audio using local Kokoro via sherpa-onnx.
Install sherpa-onnx 1.13.8 and numpy; obtain the official kokoro-en-v0_19 model.
No student data or online service is used. Model weights are not distributed.
"""
import argparse, hashlib, json, subprocess, time, wave
from pathlib import Path
import numpy as np
import sherpa_onnx
P=Path(__file__).resolve().parent.parent
ap=argparse.ArgumentParser();ap.add_argument('--model',required=True,type=Path);ap.add_argument('--cache',required=True,type=Path);ap.add_argument('--limit',type=int);ap.add_argument('--threads',type=int,default=1);args=ap.parse_args()
model=args.model;cache=args.cache;cache.mkdir(parents=True,exist_ok=True)
out=cache/'encoded';out.mkdir(parents=True,exist_ok=True)
questions=json.loads((P/'src/questions.json').read_text())
option_sets={q['listen']:q['options'] for q in questions if not q['text']}
texts=list(dict.fromkeys(q[k] for q in questions for k in ['listen','speak']))
if args.limit:texts=texts[:args.limit]
cfg=sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(model=str(model/'model.onnx'),voices=str(model/'voices.bin'),tokens=str(model/'tokens.txt'),data_dir=str(model/'espeak-ng-data')),num_threads=args.threads),max_num_sentences=1)
tts=sherpa_onnx.OfflineTts(cfg);sr=24000;manifest={};qa=[];started=time.time()
for i,text in enumerate(texts):
    key=hashlib.sha256(('kokoro0.19|af|0.85|options-gap-v2|'+text).encode()).hexdigest()[:16]
    wav=cache/(key+'.wav');mp3=out/(key+'.mp3')
    if not wav.exists():
        chunks=[]
        is_options=text in option_sets
        segments=option_sets[text] if is_options else text.split('…')
        for j,part in enumerate(segments):
            if j: chunks.append(np.zeros(round((.4 if is_options else .65)*sr),np.float32))
            if part.strip():
                gen=tts.generate(part.strip(),sid=0,speed=.85)
                assert gen.sample_rate==sr
                a=np.asarray(gen.samples,dtype=np.float32);idx=np.where(abs(a)>.0015)[0]
                assert len(idx), 'silent speech: '+part
                a=a[max(0,int(idx[0])-round(.055*sr)):min(len(a),int(idx[-1])+round(.10*sr))]
                chunks.append(a)
        a=np.concatenate(chunks);peak=max(abs(a));rms=float(np.sqrt(np.mean(a*a)))
        a*=min(.14/max(rms,1e-6),.82/max(peak,1e-6))
        n=min(140,len(a)//2);a[:n]*=np.linspace(0,1,n);a[-n:]*=np.linspace(1,0,n)
        with wave.open(str(wav),'wb') as f:
            f.setnchannels(1);f.setsampwidth(2);f.setframerate(sr);f.writeframes(np.int16(np.clip(a,-.98,.98)*32767).tobytes())
    with wave.open(str(wav)) as f:
        dur=f.getnframes()/f.getframerate();a=np.frombuffer(f.readframes(f.getnframes()),'<i2').astype(np.float32)/32768
    assert .2<dur<50,(text,dur)
    if not mp3.exists():subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','48k','-ac','1','-ar','24000',str(mp3)],check=True)
    manifest[text]='assets/speech/'+mp3.name
    qa.append({'text':text,'key':key,'duration':round(dur,3),'rms':round(float(np.sqrt(np.mean(a*a))),5),'peak':round(float(max(abs(a))),5),'bytes':mp3.stat().st_size})
    if i%25==0:print(json.dumps({'done':i+1,'total':len(texts),'seconds':round(time.time()-started)}),flush=True)
(cache/'generation-qa.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2))
(cache/'speech-assets.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
print(json.dumps({'complete':len(qa),'duration':round(sum(x['duration'] for x in qa),2),'bytes':sum(x['bytes'] for x in qa),'elapsed':round(time.time()-started)},ensure_ascii=False),flush=True)
