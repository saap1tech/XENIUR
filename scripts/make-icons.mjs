import sharp from 'sharp';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const logo=readFileSync(root+'brand/XR_logo_vector.svg','utf8').replace(/<\?xml[^>]*>/,'');
const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="40" y="40" width="944" height="944" rx="204" fill="#19271f"/><svg x="156" y="316" width="712" height="392" viewBox="269 427 701 385">${logo.match(/<g[\s\S]*<\/g>/)[0]}</svg></svg>`);
mkdirSync(root+'brand/icons',{recursive:true});
const png=await sharp(svg).png().toBuffer();writeFileSync(root+'brand/icons/icon.png',png);
const small=await sharp(png).resize(256).png().toBuffer();
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(small.length,14);ico.writeUInt32LE(22,18);
writeFileSync(root+'brand/icons/icon.ico',Buffer.concat([ico,small]));
const chunks=[];for(const [type,size] of [['ic07',128],['ic08',256],['ic09',512],['ic10',1024]]){const data=await sharp(png).resize(size).png().toBuffer();const header=Buffer.alloc(8);header.write(type);header.writeUInt32BE(data.length+8,4);chunks.push(header,data);}
const header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(8+chunks.reduce((n,c)=>n+c.length,0),4);writeFileSync(root+'brand/icons/icon.icns',Buffer.concat([header,...chunks]));
console.log('Project logo icons generated for macOS, Windows and Linux.');
