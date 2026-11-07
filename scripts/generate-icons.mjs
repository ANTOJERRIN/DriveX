import {writeFileSync,mkdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
const outer=[[.28,.22],[.49,.22],[.70,.34],[.74,.5],[.70,.66],[.49,.78],[.28,.78]];
const inner=[[.41,.35],[.49,.35],[.60,.41],[.62,.5],[.60,.59],[.49,.65],[.41,.65]];
function inside(x,y,points){let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function crc(bytes){let sum=0xffffffff;for(const byte of bytes){sum^=byte;for(let bit=0;bit<8;bit++)sum=(sum>>>1)^((sum&1)?0xedb88320:0);}return (sum^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),body=Buffer.concat([name,data]),result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);body.copy(result,4);result.writeUInt32BE(crc(body),result.length-4);return result;}
mkdirSync('dist/icons',{recursive:true});
for(const size of [180,192,512]){
 const raw=Buffer.alloc(size*(size*4+1));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const color=inside((x+.5)/size,(y+.5)/size,outer)&&!inside((x+.5)/size,(y+.5)/size,inner)?[212,245,117]:[20,44,37];
  const offset=y*(size*4+1)+1+x*4;raw[offset]=color[0];raw[offset+1]=color[1];raw[offset+2]=color[2];raw[offset+3]=255;
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
 writeFileSync(`dist/icons/icon-${size}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
console.log('Generated 180, 192 and 512 pixel DriveX icons.');
