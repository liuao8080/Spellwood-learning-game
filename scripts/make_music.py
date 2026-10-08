"""Original 60-second looping chamber-fantasy score. No sampled third-party audio."""
from pathlib import Path
import numpy as np,wave
SR=32000; BPM=96; beat=60/BPM; bars=24; duration=bars*4*beat; N=int(SR*duration)
rng=np.random.default_rng(240610); out=np.zeros((N,2),dtype=np.float64)
def freq(n):return 440*2**((n-69)/12)
def add(start,dur,notes,amp=0.1,kind='harp',pan=0):
 n=int(dur*SR);t=np.arange(n)/SR; sig=np.zeros(n)
 for note in notes:
  f=freq(note)
  if kind=='pad':
   x=sum(np.sin(2*np.pi*f*k*t+0.006*np.sin(2*np.pi*(.4+k*.08)*t))/(k*k) for k in range(1,6));env=np.minimum(t/1.1,1)*np.minimum((dur-t)/1.1,1)
  elif kind=='flute':
   phase=2*np.pi*f*t+.028*np.sin(2*np.pi*5*t);x=np.sin(phase)+.12*np.sin(phase*2)+.035*rng.standard_normal(n);env=np.minimum(t/.1,1)*np.minimum((dur-t)/.2,1)
  elif kind=='bell':
   x=sum(np.sin(2*np.pi*f*k*t)*np.exp(-t*(2+k*.7))/(k**1.25) for k in [1,2,3,4]);env=np.minimum(t/.004,1)
  else:
   x=sum(np.sin(2*np.pi*f*k*t)*np.exp(-t*(2.2+k*.65))/(k**1.6) for k in range(1,8));env=np.minimum(t/.006,1)
  sig+=x*env*amp/len(notes)
 gains=[np.sqrt((1-pan)/2),np.sqrt((1+pan)/2)];idx=(int(start*SR)+np.arange(n))%N
 for c in range(2):np.add.at(out[:,c],idx,sig*gains[c])
chords=[[50,53,57,60],[46,50,53,57],[48,53,57,60],[48,52,55,59],[50,53,57,62],[43,50,55,58],[46,50,53,58],[45,52,57,61]]
melodies=[[74,77,76,74],[77,74,72],[72,69,72,77],[76,72,71],[74,77,81],[79,77,74],[77,74,70],[73,76,69]]
for bar in range(bars):
 ch=chords[bar%8];t0=bar*4*beat
 add(t0,4*beat+.6,ch,.17,'pad',-.18 if bar%2 else .18)
 add(t0,2.8*beat,[ch[0]-12],.10,'pad',0)
 order=[0,2,1,3,2,1,3,2]
 for j,k in enumerate(order):add(t0+j*.5*beat,1.2,[ch[k]+12],.135 if j%2==0 else .09,'harp',-.4 if j%2 else .4)
 if bar%4 in [0,1,3]:
  line=melodies[bar%8]
  for j,note in enumerate(line):add(t0+(.5+j*.9)*beat,.8*beat,[note+(12 if bar>=16 and bar%4==3 else 0)],.055,'flute',.12)
 if bar%4==0:add(t0,3,[ch[2]+24],.035,'bell',-.3)
 for j in range(8):
  nn=int(.07*SR);t=np.arange(nn)/SR;noise=rng.standard_normal(nn);noise=np.r_[0,np.diff(noise)];sig=noise*np.exp(-t*55)*.009;idx=(int((t0+j*.5*beat)*SR)+np.arange(nn))%N
  out[idx,0]+=sig*.8;out[idx,1]+=sig*.7
 for b in [0,2]:
  nn=int(.15*SR);t=np.arange(nn)/SR;sig=np.sin(2*np.pi*(65*t-80*t*t))*np.exp(-t*26)*.045;idx=(int((t0+b*beat)*SR)+np.arange(nn))%N;out[idx]+=sig[:,None]
# Circular short reverb/delay preserves a seamless loop; no sudden end fade.
wet=out.copy()
for delay,level in [(.13,.14),(.23,.1),(.37,.08),(.59,.06)]:wet+=np.roll(out,int(delay*SR),axis=0)[:,::-1]*level
wet=np.tanh(wet*1.5);peak=np.max(np.abs(wet));wet*=.76/peak
p=Path('deliverables/spellwood-original-score.wav');p.parent.mkdir(exist_ok=True)
with wave.open(str(p),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes((wet*32767).astype('<i2').tobytes())
print(f'{duration:.1f}s original score; peak={np.max(np.abs(wet)):.3f}, RMS={np.sqrt(np.mean(wet**2)):.3f}')
