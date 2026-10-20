import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, withGenerationKey } from '../src/app/protect/client.js';
import { createSessionHandler, protect, memoryKV } from '../server/protect/index.js';
const branch = 'claude/resolved-scene-palette-rules-i2ko7r';
const base = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: branch, SONMIRA_TOKEN_SECRET: 'preview-test-secret-0123456789abcdef', SONMIRA_INVITE_CODES: 'PR27-TEST', SONMIRA_DAILY_CAP_USD: '1' };
function setup(env) {
 const kv = memoryKV(); let calls = 0;
 const deps = { env, kv, log: () => {} };
 const session = createSessionHandler(deps);
 const generate = protect('generate', async (_req,res) => { calls++; res.status(200).json({ok:true,image:'stub'}); }, deps);
 const fetchImpl = async (url, init={}) => {
   let status=200, body;
   const res={setHeader(){},status(n){status=n;return res},json(v){body=v;return res},end(){return res}};
   const path=new URL(url).pathname;
   await (path==='/api/session'?session:generate)({method:init.method||'GET',headers:{...Object.fromEntries(new Headers(init.headers)), 'x-forwarded-for':'127.0.0.1'},body:init.body?JSON.parse(init.body):{}},res);
   return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 };
 return {fetchImpl,calls:()=>calls};
}
test('PR27 Preview needs no invite prompt and still stops at the $1 cap',async()=>{
 const s=setup({...base,SONMIRA_LIMIT_GENERATE_HOUR:'100'});
 const client=createApiClient({fetchImpl:s.fetchImpl,storage:null,origin:'https://preview.test',askInvite:async()=>assert.fail('must not ask for code')});
 for(let i=0;i<6;i++) assert.equal((await withGenerationKey(`preview-take-${i}`,()=>client.fetch('https://preview.test/api/generate',{method:'POST',body:'{}'}))).status,200);
 const blocked=await withGenerationKey('preview-take-overflow',()=>client.fetch('https://preview.test/api/generate',{method:'POST',body:'{}'}));
 assert.equal((await blocked.json()).code,'spend_cap'); assert.equal(s.calls(),6);
});
test('Production and other previews cannot request automatic admission',async()=>{
 for(const env of [{...base,VERCEL_ENV:'production'},{...base,VERCEL_GIT_COMMIT_REF:'another-branch'}]){
   const s=setup(env);
   assert.equal((await (await s.fetchImpl('https://preview.test/api/session')).json()).autoAccess,false);
   const r=await s.fetchImpl('https://preview.test/api/session',{method:'POST',body:JSON.stringify({preview:true,installId:'install-aaaaaaaaaaaaaaaa'})});
   assert.equal(r.status,401); assert.equal(s.calls(),0);
 }
});
