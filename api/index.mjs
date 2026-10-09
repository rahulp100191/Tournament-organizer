let application;
export default async function handler(req,res){
 try {application??=(await import('../server/runtime.mjs')).default;return application(req,res);}
 catch(error){const missing=error.message?.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/);console.error('api_initialization_failed',{code:error.code||'INITIALIZATION_FAILED',dependency:missing?.[1]});res.status(503).json({error:{code:error.code||'INITIALIZATION_FAILED',message:missing?'Server dependency missing: '+missing[1]:'Server initialization failed: '+String(error.message).slice(0,500)}});}
}
