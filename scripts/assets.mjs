import fs from 'node:fs/promises';
import sharp from 'sharp';
await fs.mkdir('public/images',{recursive:true});
const photos={tennis:'photo-1554068865-24cecd4e34b8',badminton:'photo-1622279457486-62dcc4a431d6',pickleball:'photo-1595435934249-5df7ed86e1c0',running:'photo-1552674605-db6ffd4facb5',football:'photo-1574629810360-7efbbe195018'};
for(const [name,id] of Object.entries(photos)){const r=await fetch(`https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=85`);if(!r.ok)throw new Error(`${name}: ${r.status}`);await fs.writeFile(`public/images/${name}.jpg`,Buffer.from(await r.arrayBuffer()));console.log('Saved '+name)}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#143c2d"/><rect x="94" y="94" width="324" height="324" rx="85" fill="#d8f179"/><path d="M174 350V176h65v29c17-26 42-37 78-33v63c-45-4-78 20-78 68v47z" fill="#143c2d"/><circle cx="345" cy="336" r="17" fill="#143c2d"/></svg>`;
for(const size of [192,512])await sharp(Buffer.from(svg)).resize(size,size).png().toFile(`public/icon-${size}.png`);
await sharp(Buffer.from(svg)).png().toFile('public/icon-maskable.png');
