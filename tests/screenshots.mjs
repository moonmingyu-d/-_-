import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
const SITE='/tmp/claude-0/-home-user----/f0e616e8-fe43-59aa-bad2-3ae2dd85fdc9/scratchpad/shotsite';
rmSync(SITE,{recursive:true,force:true}); mkdirSync(SITE,{recursive:true});
cpSync('public',SITE,{recursive:true});
writeFileSync(`${SITE}/index.html`, readFileSync(`${SITE}/index.html`,'utf8').replace(
  /const FIREBASE_CONFIG = \{[\s\S]*?\n\};/,
  `const FIREBASE_CONFIG = { apiKey:"demo-key", authDomain:"demo-bali.firebaseapp.com", projectId:"demo-bali", storageBucket:"demo-bali.appspot.com", messagingSenderId:"000000000000", appId:"1:0:web:demo" };`));
const server=spawn('python3',['-m','http.server','8792','--directory',SITE],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium'});
const c=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
const p=await c.newPage();
await p.goto('http://127.0.0.1:8792/index.html?emu=1',{waitUntil:'load'});
await p.screenshot({path:'test-results/1-gate.png'});
await p.fill('#roomInput','bali-shot-demo-room');
await p.click('#joinBtn');
for(let i=0;i<80;i++){ if((await p.locator('#status').textContent()).includes('연결됨')) break; await sleep(150); }
await sleep(500);
await p.screenshot({path:'test-results/2-top.png'});
await p.evaluate(()=>document.querySelector('#days').scrollIntoView());
await sleep(300);
await p.screenshot({path:'test-results/3-days.png'});
await p.evaluate(()=>document.querySelector('#total').scrollIntoView({block:'center'}));
await sleep(300);
await p.screenshot({path:'test-results/4-budget.png'});
await b.close(); server.kill();
console.log('shots ok');
