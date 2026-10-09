import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{try{let p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(p!==root&&!p.startsWith(root+path.sep)){res.writeHead(403);res.end();return}if(p===root)p=path.join(root,'index.html');const b=await fs.readFile(p);res.writeHead(200,{'Content-Type':types[path.extname(p)]||'application/octet-stream','Cache-Control':p.endsWith('sw.js')?'no-cache':'public, max-age=0'});res.end(b)}catch{res.writeHead(404);res.end('Not found')}}).listen(4174,'127.0.0.1',()=>console.log('Rally static demo: http://localhost:4174'));
