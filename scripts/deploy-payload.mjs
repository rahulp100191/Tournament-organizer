import fs from 'node:fs/promises';
import path from 'node:path';
async function walk(dir){const found=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())found.push(...await walk(p));else found.push(p)}return found}
const files=[];for(const p of await walk('dist'))files.push({file:path.relative('dist',p).replaceAll('\\','/'),data:(await fs.readFile(p)).toString('base64'),encoding:'base64'});
files.push({file:'vercel.json',data:JSON.stringify({version:2,headers:[{source:'/sw.js',headers:[{key:'Cache-Control',value:'no-cache'}]}]})});
await fs.mkdir('.tools',{recursive:true});
await fs.writeFile('.tools/deployment.json',JSON.stringify(files));
console.log(JSON.stringify({files:files.length,characters:JSON.stringify(files).length}));
