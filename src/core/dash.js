import { XMLParser } from 'fast-xml-parser';
import { httpUrl } from './media.js';
const array=value=>value===undefined?[]:Array.isArray(value)?value:[value];
const duration=value=>{const m=/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?([\d.]+)?S?$/.exec(value||'');return m ? (+m[1]||0)*86400+(+m[2]||0)*3600+(+m[3]||0)*60+(+m[4]||0) : 0;};
export function parseDash(text,url) {
  if(text.length>8*1024*1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Invalid DASH manifest.');
  const mpd=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',removeNSPrefix:true,parseTagValue:false}).parse(text).MPD;
  if(!mpd) throw new Error('Invalid DASH manifest.');
  if(mpd.type==='dynamic') throw new Error('Live DASH streams are not supported.');
  const periods=array(mpd.Period);if(periods.length!==1) throw new Error('DASH with multiple periods is not supported.');
  const period=periods[0], seconds=duration(period.duration)||duration(mpd.mediaPresentationDuration);
  const base=(node,parent)=>{const value=array(node.BaseURL)[0];return value ? httpUrl(typeof value==='object'?value['#text']:value,parent) : parent;};
  const root=base(period,base(mpd,url)), tracks=[];
  const replace=(value,rep,n,t)=>String(value).replace(/\$\$/g,'\u0000').replace(/\$(RepresentationID|Bandwidth|Number|Time)(?:%0(\d+)d)?\$/g,(_,key,width)=>String(({RepresentationID:rep.id,Bandwidth:rep.bandwidth,Number:n,Time:t})[key]).padStart(+width||0,'0')).replaceAll('\u0000','$');
  for(const adaptation of array(period.AdaptationSet)) {
    if(Object.hasOwn(adaptation,'ContentProtection')) throw new Error('Encrypted DASH streams are not supported.');
    for(const rep of array(adaptation.Representation)) {
      if(Object.hasOwn(rep,'ContentProtection')) throw new Error('Encrypted DASH streams are not supported.');
      const parent=base(adaptation,root), resource=base(rep,parent), mime=rep.mimeType||adaptation.mimeType||adaptation.contentType||'';
      if(!/video|audio/.test(mime)) continue;
      const template=rep.SegmentTemplate||adaptation.SegmentTemplate ? {...adaptation.SegmentTemplate,...rep.SegmentTemplate} : null, list=rep.SegmentList||adaptation.SegmentList;
      const track={id:String(rep.id),mime,codecs:rep.codecs||adaptation.codecs||'',width:+rep.width||0,height:+rep.height||0,bandwidth:+rep.bandwidth||0,segments:[]};
      if(template) {
        const scale=+template.timescale||1, start=+template.startNumber||1;
        const add=(n,t)=>{if(track.segments.length>=30000) throw new Error('DASH manifest has too many segments.');track.segments.push({url:httpUrl(replace(template.media,rep,n,t),resource)});};
        if(template.initialization) track.init={url:httpUrl(replace(template.initialization,rep,start,0),resource)};
        let time=0,n=start;
        if(template.SegmentTimeline) for(const s of array(template.SegmentTimeline.S)) {
          if(s.t!==undefined) time=+s.t;
          const d=+s.d;if(!(d>0)) throw new Error('Invalid DASH timeline.');
          let repeats=+s.r||0;
          if(repeats<0) {if(!seconds) throw new Error('Unbounded DASH timeline.');repeats=Math.ceil((seconds*scale-time)/d)-1;}
          for(let i=0;i<=repeats;i++){add(n++,time);time+=d;}
        } else {
          if(!seconds || !(+template.duration>0)) throw new Error('DASH duration is missing.');
          for(let i=0;i<Math.ceil(seconds*scale/+template.duration);i++) add(start+i,i*+template.duration);
        }
      } else if(list) {
        const range=value=>{if(!value)return undefined;const [start,end]=value.split('-').map(Number);return {start,end};};
        if(list.Initialization) track.init={url:httpUrl(list.Initialization.sourceURL||resource,resource),range:range(list.Initialization.range)};
        track.segments=array(list.SegmentURL).map(s=>({url:httpUrl(s.media||resource,resource),range:range(s.mediaRange)}));
      } else {
        if(resource===url || resource.endsWith('/')) throw new Error('Unsupported DASH segment layout.');
        track.segments=[{url:resource}];
      }
      if(!track.segments.length || track.segments.some(s=>!s.url) || track.init&&!track.init.url) throw new Error('Invalid DASH media URL.');
      tracks.push(track);
    }
  }
  const audio=tracks.filter(t=>/audio/.test(t.mime)).sort((a,b)=>b.bandwidth-a.bandwidth)[0];
  const variants=tracks.filter(t=>/video/.test(t.mime)).sort((a,b)=>Number(/avc1|avc3/.test(b.codecs))-Number(/avc1|avc3/.test(a.codecs))||b.height-a.height||b.bandwidth-a.bandwidth).map(t=>({url:`${url}#vh=${encodeURIComponent(t.id)}`,width:t.width,height:t.height,video:t,audio,duration:seconds}));
  if(!variants.length) throw new Error('No supported video tracks in this DASH manifest.');
  return {variants,duration:seconds,children:tracks.flatMap(t=>t.segments.map(s=>s.url))};
}
