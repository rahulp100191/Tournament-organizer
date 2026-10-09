import {build} from 'esbuild';
await build({entryPoints:['server/handler.ts'],outfile:'api/index.mjs',bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',legalComments:'none'});
console.log('Bundled Vercel API: api/index.mjs');
