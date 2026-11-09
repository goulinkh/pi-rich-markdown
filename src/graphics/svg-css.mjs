// Resolve CSS custom properties and color-mix() in an SVG so resvg can render it.
function parseHex(h){h=h.trim().replace('#','');if(h.length===3)h=[...h].map(c=>c+c).join('');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));}
function hex(rgb){return '#'+rgb.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');}
function splitTop(s){const out=[];let d=0,cur='';for(const ch of s){if(ch==='(')d++;if(ch===')')d--;if(ch===','&&d===0){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out.map(x=>x.trim());}
function findCall(s,name){const i=s.indexOf(name+'(');if(i<0)return null;let d=0;for(let j=i+name.length;j<s.length;j++){if(s[j]==='(')d++;else if(s[j]===')'){d--;if(d===0)return{start:i,end:j+1,inner:s.slice(i+name.length+1,j)};}}return null;}
export function resolveSvgCss(svg, rootVars){
  const vars=new Map(Object.entries(rootVars));
  const styleAttr=/<svg[^>]*style="([^"]*)"/.exec(svg)?.[1]??'';
  for(const m of styleAttr.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) if(!vars.has(m[1])) vars.set(m[1],m[2].trim());
  for(const m of svg.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) if(!vars.has(m[1])) vars.set(m[1],m[2].trim());
  const resolve=(expr,depth=0)=>{
    if(depth>20)return expr;
    let call;
    while((call=findCall(expr,'var'))){const [name,...fb]=splitTop(call.inner);const v=vars.has(name)?resolve(vars.get(name),depth+1):(fb.length?resolve(fb.join(','),depth+1):'');expr=expr.slice(0,call.start)+v+expr.slice(call.end);}
    while((call=findCall(expr,'color-mix'))){const parts=splitTop(call.inner);const a=/^(\S+)(?:\s+([\d.]+)%)?$/.exec(parts[1]);const b=/^(\S+)(?:\s+([\d.]+)%)?$/.exec(parts[2]);let v='#888888';if(a&&b){const pa=a[2]!==undefined?+a[2]/100:(b[2]!==undefined?1-b[2]/100:.5);const ca=parseHex(resolve(a[1])),cb=parseHex(resolve(b[1]));v=hex(ca.map((x,i)=>x*pa+cb[i]*(1-pa)));}expr=expr.slice(0,call.start)+v+expr.slice(call.end);}
    return expr;
  };
  for(const [k,v] of vars) vars.set(k,resolve(v));
  let out=svg.replace(/@import[^;]*;/g,'');
  // Replace var() everywhere outside custom-property definitions
  out=out.replace(/(fill|stroke|color|stop-color|background)\s*(=|:)\s*("?)(var\([^"';]*\)|color-mix\([^"';]*\))/g,(m,p,sep,q,expr)=>`${p}${sep}${q}${resolve(expr)}`);
  let call;let guard=0;
  while((call=findCall(out,'var'))&&guard++<10000){out=out.slice(0,call.start)+resolve(out.slice(call.start,call.end))+out.slice(call.end);}
  return out;
}
