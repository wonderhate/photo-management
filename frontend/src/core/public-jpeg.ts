// Public packages contain display pixels only, including when an exported
// directory was edited outside the app. Remove every APP and comment segment.
export function publicJpeg(input:Uint8Array):{bytes:Uint8Array;width:number;height:number}{
  const fail=():never=>{throw new Error('Public images must be complete JPEG display copies.');};
  if(input.length<4||input[0]!==255||input[1]!==216)fail();
  const parts:Uint8Array[]=[input.subarray(0,2)];let offset=2,width=0,height=0,scans=0,ended=false;
  while(offset<input.length){
    const start=offset;if(input[offset++]!==255)fail();
    while(input[offset]===255)offset++;
    const marker=input[offset++];
    if(marker===217){if(!scans||offset!==input.length)fail();parts.push(input.subarray(start,offset));ended=true;break;}
    if(marker===undefined||marker===0||marker===216||marker>=208&&marker<=215)fail();
    if(offset+2>input.length)fail();
    const length=input[offset]*256+input[offset+1],end=offset+length;
    if(length<2||end>input.length)fail();
    if([192,193,194].includes(marker)){
      if(length<8||width||input[offset+2]!==8)fail();
      height=input[offset+3]*256+input[offset+4];width=input[offset+5]*256+input[offset+6];
      if(!width||!height||width>8192||height>8192)fail();
    }
    if(!(marker>=224&&marker<=239)&&marker!==254)parts.push(input.subarray(start,end));
    offset=end;
    if(marker===218){
      if(!width)fail();scans++;const scanStart=offset;
      // Stuffed FF bytes and restart markers belong to the compressed pixels.
      while(offset<input.length){
        if(input[offset]!==255){offset++;continue;}
        let next=offset+1;while(input[next]===255)next++;
        if(input[next]===0||input[next]>=208&&input[next]<=215){offset=next+1;continue;}
        break;
      }
      parts.push(input.subarray(scanStart,offset));
    }
  }
  if(!ended||!width||!height)fail();
  const bytes=new Uint8Array(parts.reduce((size,part)=>size+part.length,0));let position=0;
  for(const part of parts){bytes.set(part,position);position+=part.length;}
  return {bytes,width,height};
}
