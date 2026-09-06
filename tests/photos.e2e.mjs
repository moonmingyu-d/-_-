/* 사진 첨부 기능 검증 — 실제로 사진 파일을 올려서 확인합니다. */
import { chromium } from 'playwright';
import { mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const SITE = '/tmp/claude-0/-home-user----/f0e616e8-fe43-59aa-bad2-3ae2dd85fdc9/scratchpad/psite';
const PORT = 8798;
const ROOM = 'bali-photo-' + Math.random().toString(36).slice(2, 8) + '-room';

rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
cpSync('public', SITE, { recursive: true });
writeFileSync(`${SITE}/index.html`, readFileSync(`${SITE}/index.html`, 'utf8').replace(
  /const FIREBASE_CONFIG = \{[\s\S]*?\n\};/,
  `const FIREBASE_CONFIG = { apiKey:"demo-key", authDomain:"demo-bali.firebaseapp.com", projectId:"demo-bali", storageBucket:"demo-bali.appspot.com", messagingSenderId:"000000000000", appId:"1:0:web:demo" };`));

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', SITE], { stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}/index.html?emu=1`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pass = [];
const ok = n => { pass.push(n); console.log('  ✓ ' + n); };
async function until(fn, label, ms = 20000){
  const t0 = Date.now(); let last;
  while(Date.now() - t0 < ms){
    try{ last = await fn(); if(last) return last; }catch(e){ last = e.message; }
    await sleep(180);
  }
  throw new Error(`시간 초과: ${label} (마지막 값: ${JSON.stringify(last)})`);
}

let browser;
try{
  browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const open = async () => {
    const ctx = await browser.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('  [페이지 오류] ' + e.message));
    page.on('console', m => { if(m.type() === 'error') console.log('  [콘솔] ' + m.text()); });
    await page.goto(BASE, { waitUntil:'load' });
    await page.fill('#roomInput', ROOM);
    await page.click('#joinBtn');
    await until(async () => (await page.locator('#status').textContent()).includes('연결됨'), '연결');
    return page;
  };
  const A = await open(), B = await open();
  console.log(`\n방 ${ROOM}\n`);

  /* 휴대폰으로 찍은 큰 사진을 흉내 낸 파일 (3000×2000) */
  const makeJpeg = async (label) => {
    const url = await A.evaluate(t => {
      const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 3000, 2000);
      grad.addColorStop(0, '#2E6B4B'); grad.addColorStop(1, '#33707D');
      g.fillStyle = grad; g.fillRect(0, 0, 3000, 2000);
      for(let i = 0; i < 400; i++){                    // 압축이 잘 안 되도록 잡음 추가
        g.fillStyle = `hsl(${(i*37)%360} 60% ${30+(i%40)}%)`;
        g.fillRect((i*151)%3000, (i*233)%2000, 40, 40);
      }
      g.fillStyle = '#fff'; g.font = 'bold 200px sans-serif'; g.fillText(t, 200, 1100);
      return c.toDataURL('image/jpeg', 0.92);
    }, label);
    return Buffer.from(url.split(',')[1], 'base64');
  };
  const upload = async (page, sel, files) => {
    const [chooser] = await Promise.all([ page.waitForEvent('filechooser'), page.locator(sel).click() ]);
    await chooser.setFiles(files);
  };

  const big = await makeJpeg('PICKUP');
  console.log(`  (원본 사진 ${(big.length/1024/1024).toFixed(1)}MB · 3000×2000)`);

  /* ---------- 1. 일정에 사진 붙이기 ---------- */
  assert.ok(await A.locator('[data-cam="dayItem"][data-path="0.1"]').count() > 0, '📷 버튼이 없음');
  await upload(A, '[data-cam="dayItem"][data-path="0.1"]',
               [{ name:'pickup.jpg', mimeType:'image/jpeg', buffer: big }]);
  await until(async () => (await A.locator('.item .ph-thumb img[data-photo]').count()) === 1, '내 화면에 미리보기');
  ok('📷 로 사진을 올리면 그 일정 줄 아래 미리보기가 붙음');

  /* ---------- 2. 상대방 화면에도 ---------- */
  await until(async () => {
    const n = await B.locator('.item .ph-thumb img[data-photo]').count();
    if(n !== 1) return false;
    return await B.locator('.item .ph-thumb img[data-photo]').first().evaluate(i => !!i.getAttribute('src'));
  }, '상대방 화면에 사진 도착');
  ok('상대방 화면에도 사진이 자동으로 나타남');

  /* 어느 줄에 붙었는지 확인 */
  const row = await B.locator('.item', { has: B.locator('.ph-thumb') }).first().innerText();
  assert.ok(row.includes('덴파사르'), '엉뚱한 줄에 붙었음: ' + row);
  ok('사진이 정확히 그 일정 줄(덴파사르 도착 → 공항 픽업)에 붙음');

  /* ---------- 3. 크게 보기 ---------- */
  await B.locator('.item .ph-thumb').first().click();
  await until(async () => await B.locator('#viewer').isVisible(), '크게 보기 열림');
  const v = await B.evaluate(() => {
    const i = document.getElementById('viewerImg');
    return { w: i.naturalWidth, h: i.naturalHeight, len: i.src.length,
             n: document.getElementById('viewerN').textContent,
             prev: document.getElementById('vPrev').disabled,
             next: document.getElementById('vNext').disabled };
  });
  assert.ok(v.w > 0, '큰 사진이 안 뜸');
  assert.ok(v.w <= 1280 && v.h <= 1280, `줄이기 실패: ${v.w}×${v.h}`);
  assert.ok(v.len < 620000, `한 장이 ${v.len}자로 한도 초과`);
  assert.equal(v.n.trim(), '1 / 1');
  assert.equal(v.prev, true); assert.equal(v.next, true);
  console.log(`    · 3000×2000 ${(big.length/1024).toFixed(0)}KB → ${v.w}×${v.h} ${(v.len/1024).toFixed(0)}KB 로 압축`);
  ok('사진을 누르면 크게 보이고, 자동으로 줄여 저장됨 (1장뿐이면 이전/다음 비활성)');
  await B.locator('#vClose').click();
  assert.equal(await B.locator('#viewer').isVisible(), false);
  ok('닫기 정상 동작');

  /* ---------- 4. 예약에 여러 장 한 번에 ---------- */
  const j2 = await makeJpeg('VOUCHER'), j3 = await makeJpeg('SHUTTLE');
  await upload(A, '[data-cam="bookings"][data-path="2"]', [
    { name:'a.jpg', mimeType:'image/jpeg', buffer: j2 },
    { name:'b.jpg', mimeType:'image/jpeg', buffer: j3 }]);
  await until(async () => (await A.locator('#bookings .ph-thumb').count()) === 2, '예약에 2장');
  await until(async () => (await B.locator('#bookings .ph-thumb').count()) === 2, '상대방 예약에 2장');
  ok('확정 예약에도 붙고, 여러 장을 한 번에 올릴 수 있음');

  await B.locator('#bookings .ph-thumb').first().click();
  await until(async () => await B.locator('#viewer').isVisible(), '뷰어');
  assert.equal((await B.locator('#viewerN').textContent()).trim(), '1 / 2');
  assert.equal(await B.locator('#vNext').isDisabled(), false);
  await B.locator('#vNext').click();
  assert.equal((await B.locator('#viewerN').textContent()).trim(), '2 / 2');
  assert.equal(await B.locator('#vNext').isDisabled(), true);
  ok('여러 장일 때 이전/다음으로 넘겨볼 수 있음');
  await B.locator('#vClose').click();

  /* ---------- 5. 순서를 바꿔도 사진이 따라간다 ---------- */
  await A.click('#orderBtn'); await sleep(300);
  assert.equal(await A.locator('.cam').count(), 0, '순서 모드에서 📷 가 남아있음');
  ok('순서 바꾸기 중에는 📷 가 숨겨짐');
  await A.locator('[data-move="-1"][data-kind="dayItem"][data-path="0.1"]').click();
  await sleep(400);
  await A.click('#orderBtn'); await sleep(300);
  const movedRow = await A.locator('.item', { has: A.locator('.ph-thumb') }).first().innerText();
  assert.ok(movedRow.includes('덴파사르'), '사진이 다른 줄로 옮겨갔음: ' + movedRow);
  const idx = await A.evaluate(() =>
    [...document.querySelectorAll('.day:nth-of-type(1) .item')].findIndex(x => x.querySelector('.ph-thumb')));
  assert.equal(idx, 0, '항목이 위로 안 올라감');
  ok('▲ 로 항목을 옮기면 붙은 사진도 그대로 따라감');

  /* ---------- 6. 사진 지우기 ---------- */
  await A.locator('.item .ph-thumb').first().click();
  await until(async () => await A.locator('#viewer').isVisible(), '뷰어');
  A.once('dialog', d => d.accept());
  await A.locator('#vDel').click();
  await until(async () => (await A.locator('.item .ph-thumb').count()) === 0, '내 화면에서 사라짐');
  await until(async () => (await B.locator('.item .ph-thumb').count()) === 0, '상대방 화면에서도 사라짐');
  assert.equal(await A.locator('#viewer').isVisible(), false, '마지막 장을 지우면 뷰어가 닫혀야 함');
  ok('사진을 지우면 양쪽에서 사라지고 뷰어가 닫힘');

  /* ---------- 7. 항목을 지우면 딸린 사진도 정리 ---------- */
  const before = await B.locator('#bookings .ph-thumb').count();
  assert.equal(before, 2);
  A.once('dialog', d => d.accept());
  await A.locator('#bookings .card').nth(2).locator('.del').click();
  await until(async () => (await B.locator('#bookings .ph-thumb').count()) === 0, '예약과 함께 사진도 사라짐');
  ok('예약 항목을 지우면 딸린 사진도 함께 정리됨');

  /* ---------- 8. 기존 기능 회귀 ---------- */
  await A.locator('[data-path="tips.0"]').click();
  await A.keyboard.press('Control+a');
  await A.keyboard.type('사진 기능 넣은 뒤 확인');
  await A.keyboard.press('Enter');
  await until(async () => (await B.locator('#tips').innerText()).includes('사진 기능 넣은 뒤 확인'), '글자 수정');
  ok('글자 수정 등 기존 동기화는 그대로 동작');

  /* ---------- 9. 휴대폰 화면 ---------- */
  const j4 = await makeJpeg('MAP');
  await upload(A, '[data-cam="dayItem"][data-path="0.0"]',
               [{ name:'m.jpg', mimeType:'image/jpeg', buffer: j4 }]);
  await until(async () => (await A.locator('.item .ph-thumb').count()) === 1, '사진');
  const m = await A.evaluate(() => {
    const t = document.querySelector('.ph-thumb').getBoundingClientRect();
    const c = document.querySelector('.cam');
    const a = getComputedStyle(c, '::after');
    return { tw: Math.round(t.width), th: Math.round(t.height),
             cw: Math.round(Math.max(c.getBoundingClientRect().width, parseFloat(a.width)||0)),
             ch: Math.round(Math.max(c.getBoundingClientRect().height, parseFloat(a.height)||0)),
             docW: document.documentElement.scrollWidth, winW: window.innerWidth };
  });
  assert.ok(m.tw >= 60 && m.th >= 60, `미리보기가 ${m.tw}×${m.th}px 로 작음`);
  assert.ok(m.cw >= 38 && m.ch >= 38, `📷 터치 영역이 ${m.cw}×${m.ch}px 로 작음`);
  assert.ok(m.docW <= m.winW + 1, `가로 스크롤 발생 (${m.docW} > ${m.winW})`);
  console.log(`    · 미리보기 ${m.tw}×${m.th}px · 📷 터치 영역 ${m.cw}×${m.ch}px · 가로 스크롤 없음`);
  ok('아이폰 폭 390px 에서 미리보기 크기·터치 영역·가로 스크롤 정상');

  await A.screenshot({ path:'test-results/11-photo-item.png', fullPage:false });
  await A.locator('.item .ph-thumb').first().click();
  await sleep(500);
  await A.screenshot({ path:'test-results/12-photo-viewer.png' });

  console.log(`\n통과 ${pass.length}개 / 실패 0개\n`);
}catch(err){
  console.error('\n❌ 실패: ' + err.message + '\n');
  process.exitCode = 1;
}finally{
  if(browser) await browser.close();
  server.kill();
}
