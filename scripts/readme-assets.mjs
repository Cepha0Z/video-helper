import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const out='docs/assets',frames='.test-output/readme-frames';
await mkdir(out,{recursive:true});await mkdir(frames,{recursive:true});
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const text=(x,y,s,size=20,color='#eff5f3',weight=400)=>`<text x="${x}" y="${y}" fill="${color}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}">${escape(s)}</text>`;
const rect=(x,y,w,h,fill,r=16,stroke='none')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
const line=(x1,y1,x2,y2,color='#33474c')=>`<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}" fill="none"/>`;
const logo=(x,y)=>rect(x,y,46,46,'#a6f0c8',13)+`<path d="M${x+23} ${y+10}v20m-8-8 8 8 8-8M${x+12} ${y+36}h22" stroke="#103b2c" stroke-width="3" fill="none" stroke-linecap="round"/>`;
const wrap=(body,w=1600,h=900)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#101e25"/><stop offset="1" stop-color="#0b111a"/></linearGradient><linearGradient id="poster" x2="1" y2="1"><stop stop-color="#28545a"/><stop offset="1" stop-color="#142731"/></linearGradient></defs>${rect(0,0,w,h,'url(#bg)',0)}${body}</svg>`;
function thumbnail(x,y,w=150,h=100){let s=rect(x,y,w,h,'url(#poster)',8);for(const [a,b,c,d] of [[24,32,75,20],[24,32,75,70],[75,20,124,48],[75,70,124,48]])s+=line(x+a,y+b,x+c,y+d,'#69b2ab');for(const [a,b]of [[24,32],[75,20],[75,70],[124,48]])s+=`<circle cx="${x+a}" cy="${y+b}" r="6" fill="#b4f4d5"/>`;return s;}
function mediaCard(x,y,title,quality='720p',running=false,w=590){return rect(x,y,w,143,'#19222b',12,'#35434b')+thumbnail(x+16,y+18)+rect(x+181,y+20,35,19,'#163d43',4)+text(x+187,y+34,'HLS',10,'#a1e5d7',600)+text(x+225,y+35,title,17,'#f1f6f4',600)+text(x+181,y+99,'MP4',13,'#a4b5ba')+rect(x+226,y+77,78,33,'#27333c',7,'#42515a')+text(x+239,y+99,quality,14)+rect(x+w-155,y+76,135,36,running?'#28483d':'#a6f0c8',20)+text(x+w-137,y+100,running?'Added':'↓ Download',15,running?'#b5ecd0':'#123528',600);}
const pills=[['Logged-in playback',66,255],['HLS · DASH · SABR',337,267],['Concurrent downloads',620,302]].map(([s,x,w])=>rect(x,740,w,47,'#182a30',24,'#34524f')+text(x+21,771,s,18,'#b0d8c8')).join('');
let hero=logo(66,58)+text(130,90,'Video Helper',28,'#f1f6f4',700)+text(1343,86,'BRAVE / CHROME',14,'#94adae',600);
hero+=text(66,239,'Beyond the',77,'#f1f6f4',700)+text(66,328,'obvious download.',77,'#a6f0c8',700)+text(70,411,'Find streams behind modern players.',27,'#b7c7cb')+text(70,453,'Save from sessions you already have access to.',27,'#b7c7cb');
hero+=text(70,556,'Authenticated playback. Adaptive streams.',20,'#dce7e4',600)+text(70,591,'One compact popup. Downloads that keep going.',20,'#8fa6ad');
hero+=rect(946,207,602,360,'#272b34',18,'#4a535d')+text(970,244,'Video Helper',19,'#f1f6f4',600)+text(1305,244,'Media',14,'#a6f0c8',600)+text(1372,244,'Downloads',14,'#b5b9c5')+line(946,268,1548,268)+mediaCard(960,284,'Neural networks · Lesson 02','720p',false,574)+text(970,535,'learn.example',13,'#92a2af');
hero+=pills+text(68,843,'LOCAL PROCESSING  /  EXPLICIT SITE ACCESS  /  NO COMPANION APP',13,'#7e969e',600)+text(1090,843,'Illustrated UI · synthetic demo media',13,'#7e969e');
const heroSvg=wrap(hero);await writeFile(`${out}/hero.svg`,heroSvg);await writeFile(`${out}/hero.png`,new Resvg(heroSvg,{font:{loadSystemFonts:true}}).render().asPng());
const stages=[['Detect what is playing','Current-page streams, grouped by quality.'],['Choose your quality','Keep the title. Pick the resolution.'],['Start the download','The popup can close. The job keeps running.'],['Move to the next lesson','New page. New media. The first job continues.'],['Download in parallel','Three active jobs, with more queued automatically.'],['Save a playable file','Merge tracks and finalize a regular MP4.']];
function frame(n){const stage=Math.min(5,Math.floor(n/12)),t=(n%12)/12;let b=logo(46,34)+text(108,65,'Video Helper',25,'#f1f6f4',700)+text(46,139,stages[stage][0],43,'#a6f0c8',700)+text(48,180,stages[stage][1],20,'#a6bbc1');
b+=rect(46,220,1188,507,'#16212a',18,'#34434c')+rect(46,220,1188,48,'#22313b',18)+text(70,251,`learn.example / lessons / ${stage>=3?'03':'02'}`,14,'#acbec5')+rect(68,287,400,360,'#101b22',12)+text(88,330,'A PRACTICAL INTRODUCTION',12,'#88aaa9',600)+text(88,374,stage>=3?'Training the network':'Neural networks',29,'#edf7f2',700)+thumbnail(111,413,300,150)+text(88,616,'Synthetic lesson footage',15,'#849da5');
b+=rect(492,287,720,399,'#272b34',13,'#48545e')+text(514,322,'Video Helper',18,'#f0f5f3',600)+text(966,322,stage>=2?'Downloads':'Media',15,'#a6f0c8',600)+line(492,341,1212,341);
if(stage<2)b+=mediaCard(509,362,'Neural networks · Lesson 02',stage===0?'1080p':'720p',false,685);
else {const rows=stage>=4?2:1;for(let i=0;i<rows;i++){let y=361+i*134,p=stage===5?100:Math.min(95,(stage-2)*22+t*19+(i===0?14:0));b+=rect(509,y,685,119,'#19222b',10,'#3c4953')+thumbnail(523,y+14,140,90)+text(680,y+30,i===0?'Neural networks · Lesson 02':'Training the network · Lesson 03',17,'#eef5f1',600)+rect(681,y+55,487,5,'#384651',3)+rect(681,y+55,Math.max(2,487*p/100),5,'#a6f0c8',3)+text(681,y+91,stage===5?'Saved':`${Math.floor(p)}%`,14,'#a6f0c8',600)+text(1090,y+91,stage===5?'MP4':'28 MB',13,'#a9bbc2');}}
b+=text(514,663,'learn.example',12,'#92a7b0')+text(47,771,'ILLUSTRATED WORKFLOW · SYNTHETIC MEDIA · NOT A LIVE DOWNLOAD RECORDING',12,'#7e969e',600)+text(1140,771,`${stage+1} / 6`,14,'#a6f0c8');return wrap(b,1280,800);}
for(let n=0;n<72;n++){const png=new Resvg(frame(n),{font:{loadSystemFonts:true}}).render().asPng();await writeFile(`${frames}/${String(n).padStart(3,'0')}.png`,png);if(n===12)await writeFile(`${out}/workflow.png`,png);}
const ffmpeg=require('@ffmpeg-installer/ffmpeg').path;
for(const args of [
 ['-y','-framerate','6','-i',`${frames}/%03d.png`,'-c:v','libx264','-preset','medium','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',`${out}/workflow.mp4`],
 ['-y','-i',`${out}/workflow.mp4`,'-filter_complex','fps=6,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer','-loop','0',`${out}/workflow.gif`]
]){const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error',...args],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);}
console.log('Generated hero, workflow poster, animated GIF and 12-second MP4.');
