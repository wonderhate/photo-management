import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageOrientation} from '../src/core/image-orientation.ts';

test('all eight orientations rotate or reflect distinct pixels without cropping or stretching',()=>{
  const expected=['AB/CD/EF','BA/DC/FE','FE/DC/BA','EF/CD/AB','ACE/BDF','ECA/FDB','FDB/ECA','BDF/ACE'];
  for(let orientation=1;orientation<=8;orientation++){
    const geometry=imageOrientation(2,3,orientation),pixels=Array<string>(6);
    const [a,b,c,d,e,f]=geometry.transform;
    for(let y=0;y<3;y++)for(let x=0;x<2;x++){const tx=Math.floor(a*(x+.5)+c*(y+.5)+e),ty=Math.floor(b*(x+.5)+d*(y+.5)+f);pixels[ty*geometry.width+tx]='ABCDEF'[y*2+x];}
    const rows=[];for(let y=0;y<geometry.height;y++)rows.push(pixels.slice(y*geometry.width,(y+1)*geometry.width).join(''));
    assert.equal(rows.join('/'),expected[orientation-1]);
  }
  for(const value of [0,9,1.5,NaN])assert.throws(()=>imageOrientation(2,3,value));
});
