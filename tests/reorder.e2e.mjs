/* 순서 바꾸기(▲▼) 기능 검증 — 브라우저 창 두 개로 실제 동작을 확인합니다. */
import { chromium } from 'playwright';
import { mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const SITE = '/tmp/claude-0/-home-user----/f0e616e8-fe43-59aa-bad2-3ae2dd85fdc9/scratchpad/rsite';
const PORT = 8795;
const ROOM = 'bali-order-' + Math.random().toString(36).slice(2, 8) + '-room';

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

async function until(fn, label, ms = 15000){
  const t0 = Date.now(); let last;
  while(Date.now() - t0 < ms){
    try{ last = await fn(); if(last) return last; }catch(e){ last = e.message; }
    await sleep(150);
  }
  throw new Error(`시간 초과: ${label} (마지막 값: ${JSON.stringify(last)})`);
}
const dayItems = page => page.$$eval('.day:nth-of-type(1) .item .item-time',
  els => els.map(e => e.textContent.trim()));

let browser;
try{
  browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const open = async () => {
    const ctx = await browser.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('  [페이지 오류] ' + e.message));
    await page.goto(BASE, { waitUntil:'load' });
    await page.fill('#roomInput', ROOM);
    await page.click('#joinBtn');
    await until(async () => (await page.locator('#status').textContent()).includes('연결됨'), '연결');
    return page;
  };
  const A = await open(), B = await open();
  console.log(`\n방 ${ROOM}\n`);

  /* ---------- 1. 평소에는 지금 디자인 그대로 ---------- */
  assert.equal(await A.locator('.mvb').count(), 0, '평소에 화살표가 보이면 안 됨');
  assert.ok(await A.locator('#days .del').count() > 0, '평소에는 ✕ 가 보여야 함');
  assert.equal(await A.locator('[data-path="days.0.items.0.text"]').getAttribute('contenteditable'), 'true');
  ok('평소 화면은 기존과 동일 (✕ 보이고 글자 수정 가능, 화살표 없음)');

  /* ---------- 2. 순서 모드 켜기 ---------- */
  await A.click('#orderBtn');
  await sleep(250);
  assert.equal(await A.locator('#days .del').count(), 0, '순서 모드에서 ✕ 가 남아있음');
  assert.ok(await A.locator('.mvb').count() > 0, '화살표가 안 나옴');
  assert.equal(await A.locator('[data-path="days.0.items.0.text"]').getAttribute('contenteditable'), 'false');
  assert.equal(await A.locator('#reorderHint').isVisible(), true);
  assert.equal(await A.locator('#editHint').isVisible(), false);
  assert.equal((await A.locator('#orderBtn').textContent()).includes('완료'), true);
  ok('순서 모드: ✕ 숨김 · 화살표 표시 · 글자 수정 잠김 · 안내문 교체');

  /* 끝 항목의 화살표는 눌리지 않아야 한다 */
  const first = A.locator('[data-move="-1"][data-kind="dayItem"][data-path="0.0"]');
  const lastIdx = (await dayItems(A)).length - 1;
  const last = A.locator(`[data-move="1"][data-kind="dayItem"][data-path="0.${lastIdx}"]`);
  assert.equal(await first.isDisabled(), true, '첫 항목의 ▲ 가 눌림');
  assert.equal(await last.isDisabled(), true, '마지막 항목의 ▼ 가 눌림');
  ok('맨 위 항목의 ▲, 맨 아래 항목의 ▼ 는 비활성 처리됨');

  /* ---------- 3. 실제로 옮기기 ---------- */
  const before = await dayItems(A);
  await A.locator('[data-move="-1"][data-kind="dayItem"][data-path="0.2"]').click();
  await sleep(300);
  const after = await dayItems(A);
  const expect = before.slice(); [expect[1], expect[2]] = [expect[2], expect[1]];
  assert.deepEqual(after, expect, `순서가 기대와 다름: ${before} → ${after}`);
  ok(`▲ 로 한 칸 위로 이동: ${before.join(' / ')} → ${after.join(' / ')}`);

  /* 다시 ▼ 로 되돌리기 */
  await A.locator('[data-move="1"][data-kind="dayItem"][data-path="0.1"]').click();
  await sleep(300);
  assert.deepEqual(await dayItems(A), before, '▼ 로 되돌리기 실패');
  ok('▼ 로 원래 자리로 되돌아옴');

  /* ---------- 4. 상대방 화면에도 반영 ---------- */
  await A.locator('[data-move="-1"][data-kind="dayItem"][data-path="0.2"]').click();
  await until(async () => (await dayItems(B)).join('|') === expect.join('|'), '상대방 화면 반영');
  ok('바뀐 순서가 상대방 화면에도 자동 반영됨');

  /* ---------- 5. 날짜 카드 통째로 옮기기 ---------- */
  const dayTitle = p => p.$$eval('.day .day-date span', e => e.map(x => x.textContent.trim()));
  const dBefore = await dayTitle(A);
  await A.locator('[data-move="1"][data-kind="days"][data-path="0"]').click();
  await sleep(300);
  const dAfter = await dayTitle(A);
  assert.equal(dAfter[0], dBefore[1], '날짜 카드가 안 밀림');
  assert.equal(dAfter[1], dBefore[0], '날짜 카드가 안 밀림');
  assert.equal(await A.locator('.day .day-n').first().textContent(), 'DAY 1', 'DAY 번호가 다시 매겨지지 않음');
  ok(`날짜(DAY) 카드도 통째로 이동 · 번호 자동 재부여 (${dBefore[0]} ↔ ${dBefore[1]})`);
  await A.locator('[data-move="-1"][data-kind="days"][data-path="1"]').click();
  await sleep(300);

  /* ---------- 6. 나머지 목록도 되는지 ---------- */
  for(const [kind, sel] of [['tips', '#tips .li-text span'],
                            ['budget', '#budget .b-label > span:first-child'],
                            ['bookings', '#bookings .card-title span'],
                            ['chkItem', '#checklist .chk-text span']]){
    const path = kind === 'chkItem' ? '0.1' : '1';
    const read = () => A.$$eval(sel, e => e.map(x => x.textContent.trim()));
    const b4 = await read();
    await A.locator(`[data-move="-1"][data-kind="${kind}"][data-path="${path}"]`).click();
    await sleep(250);
    const af = await read();
    const i = kind === 'chkItem' ? 1 : 1;
    assert.equal(af[i - 1], b4[i], `${kind} 이동 실패`);
    await A.locator(`[data-move="1"][data-kind="${kind}"][data-path="${kind === 'chkItem' ? '0.0' : '0'}"]`).click();
    await sleep(250);
    assert.deepEqual(await read(), b4, `${kind} 되돌리기 실패`);
  }
  ok('예약 · 예산 · 체크리스트 · 현지 팁 목록도 모두 이동 가능');

  /* ---------- 7. 모드 끄기 ---------- */
  await A.click('#orderBtn');
  await sleep(250);
  assert.equal(await A.locator('.mvb').count(), 0, '모드를 껐는데 화살표가 남음');
  assert.equal(await A.locator('[data-path="days.0.items.0.text"]').getAttribute('contenteditable'), 'true');
  assert.equal(await A.locator('#editHint').isVisible(), true);
  ok('모드를 끄면 원래 화면으로 완전히 복귀 (글자 수정 다시 가능)');

  /* ---------- 8. 기존 기능 회귀 확인 (삭제 코드를 정리했으므로) ---------- */
  const tipsN = await A.locator('#tips .li').count();
  A.once('dialog', d => d.accept());
  await A.locator('#tips .li').last().locator('.del').click();
  await until(async () => (await B.locator('#tips .li').count()) === tipsN - 1, '삭제 동기화');
  ok('✕ 삭제가 여전히 정상 동작하고 상대방에게도 반영됨');

  const cBefore = await B.locator('#chkCount').textContent();
  await A.locator('[data-toggle="0.0"]').click();
  await until(async () => (await B.locator('#chkCount').textContent()) !== cBefore, '체크 동기화');
  ok('체크리스트 체크도 정상 동작');

  await A.locator('[data-path="tips.0"]').click();
  await A.keyboard.press('Control+a');
  await A.keyboard.type('수정 확인용 메모');
  await A.keyboard.press('Enter');
  await until(async () => (await B.locator('#tips').innerText()).includes('수정 확인용 메모'), '글자 수정 동기화');
  ok('글자 수정도 정상 동작');

  /* ---------- 9. 휴대폰에서 누르기 편한지 ---------- */
  await A.click('#orderBtn');
  await sleep(250);
  const m = await A.evaluate(() => {
    const b = document.querySelector('.mvb');
    const r = b.getBoundingClientRect();
    const bar = document.querySelector('.bar').getBoundingClientRect();
    const btns = [...document.querySelectorAll('.btn-row .btn')].filter(x => !x.hidden);
    const rows = new Set(btns.map(x => Math.round(x.getBoundingClientRect().top))).size;
    const f = document.querySelector('footer').getBoundingClientRect();
    window.scrollTo(0, document.body.scrollHeight);
    const f2 = document.querySelector('footer').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height),
             barH: Math.round(bar.height), rows,
             gap: Math.round(document.querySelector('.bar').getBoundingClientRect().top - f2.bottom),
             docW: document.documentElement.scrollWidth, winW: window.innerWidth };
  });
  assert.ok(m.w >= 36 && m.h >= 36, `화살표가 ${m.w}×${m.h}px 로 작음`);
  assert.ok(m.docW <= m.winW + 1, `가로 스크롤 발생 (${m.docW} > ${m.winW})`);
  assert.ok(m.gap >= 0, `아래 바가 본문을 ${-m.gap}px 가림`);
  console.log(`    · 화살표 ${m.w}×${m.h}px · 아래 버튼 ${m.rows}줄 (바 높이 ${m.barH}px) · 본문 여유 ${m.gap}px`);
  ok('아이폰 폭 390px 에서 화살표 크기·바 배치·가로 스크롤 모두 정상');

  await A.screenshot({ path: 'test-results/7-reorder-on.png' });
  await A.click('#orderBtn'); await sleep(300);
  await A.screenshot({ path: 'test-results/8-reorder-off.png' });

  console.log(`\n통과 ${pass.length}개 / 실패 0개\n`);
}catch(err){
  console.error('\n❌ 실패: ' + err.message + '\n');
  process.exitCode = 1;
}finally{
  if(browser) await browser.close();
  server.kill();
}
