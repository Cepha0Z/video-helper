// Edit real extension-window captures. This script never draws replacement UI.
// First import: npm run docs:assets -- --capture-dir /path/to/private/captures
// Later edits: npm run docs:assets (uses the checked-in, privacy-cropped source).
import { Resvg } from '@resvg/resvg-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url), ffmpeg=require('@ffmpeg-installer/ffmpeg').path;
const out='docs/assets',temp='.test-output/real-demo';
await mkdir(out,{recursive:true});await mkdir(temp,{recursive:true});
const source=`${out}/live-window.mp4`;
const inputArg=process.argv.indexOf('--capture-dir');
function run(args){const r=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr);}
if(inputArg>=0){
  const captureDir=path.resolve(process.argv[inputArg+1]);
  const log=JSON.parse(await readFile(path.join(captureDir,'capture-log.json'),'utf8'));
  const phases=[['detected',3],['retake-quality-menu',3],['retake-selected',2],['retake-started',2],['retake-saved',4]];
  const encoder=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','30','-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',source],{stdio:['pipe','ignore','pipe']});
  let errors='';encoder.stderr.on('data',b=>errors+=b);const completed=once(encoder,'close');
  const rendered=new Map();
  for(const [label,duration]of phases){
    const frames=log.filter(f=>f.label===label);if(!frames.length)throw Error(`Missing real footage: ${label}`);
    // Only the current successful job is retained in the downloads shot.
    const crop=label==='retake-saved'?{x:14,y:10,w:1140,h:310}:{x:14,y:10,w:1140,h:464};
    for(let n=0;n<duration*30;n++){
      const frame=frames[Math.min(frames.length-1,Math.floor(n/(duration*30)*frames.length))];
      let png=rendered.get(frame.file);
      if(!png){
        const decoded=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-i',path.join(captureDir,frame.file),'-vf',`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`,'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],{maxBuffer:16*1024*1024});
        if(decoded.status!==0)throw Error(decoded.stderr.toString());
        const bytes=decoded.stdout,displayW=1440,displayH=crop.h/crop.w*displayW;
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#11141b"/><image x="80" y="${450-displayH/2}" width="${displayW}" height="${displayH}" href="data:image/png;base64,${bytes.toString('base64')}"/></svg>`;
        png=new Resvg(svg).render().asPng();rendered.set(frame.file,png);
      }
      if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
    }
  }
  encoder.stdin.end();const [code]=await completed;if(code!==0)throw Error(errors);
  const first=log.find(f=>f.label==='detected'),saved=log.find(f=>f.label==='retake-saved');
  run(['-i',path.join(captureDir,first.file),'-vf','crop=1140:464:14:10','-frames:v','1',`${out}/hero.png`]);
  run(['-i',path.join(captureDir,saved.file),'-vf','crop=1140:310:14:10','-frames:v','1',`${out}/saved.png`]);
}
// Cosine easing gives a smooth camera move into the cursor's actual click areas.
const ease=(a,b)=>`(0.5-0.5*cos(PI*clip((on/30-${a})/${b-a},0,1)))`;
const zoom=`1+0.28*${ease(2,3.1)}*(1-${ease(9.5,10.8)})`;
const focusX=`714+(1346-714)*${ease(6.1,7.5)}`;
const x=`clip((${focusX})-iw/(2*zoom),0,iw-iw/zoom)`;
const y='clip(545-ih/(2*zoom),0,ih-ih/zoom)';
const font='/System/Library/Fonts/Supplemental/Arial.ttf';
const caption=(s,start,end)=>`drawtext=fontfile=${font}:text='${s}':fontcolor=0xe7ebf0:fontsize=30:x=(w-tw)/2:y=h-70:enable='between(t,${start},${end})'`;
const filters=[`zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=1600x900:fps=30`,
 caption('Detected on the current page',0,2.8),caption('Choose a quality',3,5.9),caption('Start the download',6,9.8),caption('Saved as a playable MP4',10,14),
 'fade=t=in:d=0.25','fade=t=out:st=13.65:d=0.35'];
run(['-i',source,'-vf',filters.join(','),'-an','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',`${out}/workflow.mp4`]);
run(['-i',`${out}/workflow.mp4`,'-filter_complex','fps=12,scale=1120:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer','-loop','0',`${out}/workflow.gif`]);
run(['-ss','1','-i',`${out}/workflow.mp4`,'-frames:v','1',`${out}/workflow.png`]);
console.log('Edited real captured UI: screenshot, saved-file screenshot, cursor-focused MP4 and GIF.');
