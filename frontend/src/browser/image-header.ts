// Read container dimensions without allocating decoded pixels. AVIF's item
// transforms remain the browser decoder's responsibility (null fallback).
export function imageHeader(bytes:Uint8Array):{width:number;height:number}|null {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=bytes.length;
  const text=(offset:number,count:number)=>String.fromCharCode(...bytes.subarray(offset,offset+count));
  const size=(width:number,height:number)=>{
    if(!width||!height)throw new Error('The source image could not be decoded.');
    if(width*height>100_000_000)throw new Error('Photo exceeds the 100 megapixel browser processing limit.');
    return {width,height};
  };
  if(length>=2&&bytes[0]===255&&bytes[1]===216){
    let offset=2;
    while(offset+4<=length){
      if(bytes[offset++]!==255)break;
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];
      if(marker===0xda||marker===0xd9)break;
      if(marker===1||(marker>=0xd0&&marker<=0xd7))continue;
      if(offset+2>length)break;
      const count=view.getUint16(offset);
      if(count<2||offset+count>length)break;
      if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker)){
        if(count<8)break;
        return size(view.getUint16(offset+5),view.getUint16(offset+3));
      }
      offset+=count;
    }
  }else if(length>=33&&text(0,8)==='\x89PNG\r\n\x1a\n'&&view.getUint32(8)===13&&text(12,4)==='IHDR'){
    return size(view.getUint32(16),view.getUint32(20));
  }else if(length>=12&&text(0,4)==='RIFF'&&text(8,4)==='WEBP'){
    const end=view.getUint32(4,true)+8;if(end>length)throw new Error('The source image could not be decoded.');
    for(let offset=12;offset+8<=end;){
      const kind=text(offset,4),count=view.getUint32(offset+4,true),start=offset+8;
      if(start+count>end)break;
      const uint24=(at:number)=>bytes[at]+bytes[at+1]*256+bytes[at+2]*65536;
      if(kind==='VP8X'&&count>=10)return size(uint24(start+4)+1,uint24(start+7)+1);
      if(kind==='VP8L'&&count>=5&&bytes[start]===0x2f){const bits=view.getUint32(start+1,true);return size((bits&0x3fff)+1,((bits>>>14)&0x3fff)+1);}
      if(kind==='VP8 '&&count>=10&&text(start+3,3)==='\x9d\x01\x2a')return size(view.getUint16(start+6,true)&0x3fff,view.getUint16(start+8,true)&0x3fff);
      offset=start+count+(count&1);
    }
  }else if(length>=16&&text(4,4)==='ftyp'&&/avif|avis/.test(text(8,Math.min(64,length-8))))return null;
  else throw new Error('This browser release supports JPEG, PNG, WebP and AVIF.');
  throw new Error('The source image could not be decoded.');
}
