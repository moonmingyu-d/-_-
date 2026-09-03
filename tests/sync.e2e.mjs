/* 두 사람이 각자 휴대폰에서 쓰는 상황을 브라우저 창 두 개로 재현합니다.
   - 창 A = 남편, 창 B = 아내 (저장소가 완전히 분리된 별개 컨텍스트)
   - Firestore 는 로컬 에뮬레이터 사용                                        */
import { chromium } from 'playwright';
import { mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const SITE = '/tmp/claude-0/-home-user----/f0e616e8-fe43-59aa-bad2-3ae2dd85fdc9/scratchpad/site';
const PORT = 8788;
const ROOM = 'bali-test-' + Math.random().toString(36).slice(2, 8) + '-room';

/* ---- 에뮬레이터용 설정값을 넣은 사본을 만든다 ---- */
rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
cpSync('public', SITE, { recursive: true });
const html = readFileSync(`${SITE}/index.html`, 'utf8').replace(
  /const FIREBASE_CONFIG = \{[\s\S]*?\n\};/,
  `const FIREBASE_CONFIG = {
  apiKey: "demo-key",
  authDomain: "demo-bali.firebaseapp.com",
  projectId: "demo-bali",
  storageBucket: "demo-bali.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:demo"
};`);
assert.ok(html.includes('projectId: "demo-bali"'), '설정 치환 실패');
writeFileSync(`${SITE}/index.html`, html);

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', SITE],
  { stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}/index.html?emu=1`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pass = [];
function ok(name){ pass.push(name); console.log('  ✓ ' + name); }

async function until(fn, label, ms = 15000){
  const t0 = Date.now();
  let last;
  while(Date.now() - t0 < ms){
    try{ last = await fn(); if(last) return last; }catch(e){ last = e.message; }
    await sleep(150);
  }
  throw new Error(`시간 초과: ${label} (마지막 값: ${JSON.stringify(last)})`);
}

async function openApp(browser, label){
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },   // 아이폰 12~15 폭
    deviceScaleFactor: 3,
    hasTouch: true, isMobile: true
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [${label}] 페이지 오류: ${e.message}`));
  page.on('console', m => {
    if(m.type() !== 'error') return;
    if(m.text().includes('ERR_INTERNET_DISCONNECTED')) return;   // 오프라인 시험 중엔 정상
    console.log(`  [${label}] 콘솔: ${m.text()}`);
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.fill('#roomInput', ROOM);
  await page.click('#joinBtn');
  await until(async () => (await page.locator('#status').textContent()).includes('연결됨'), `${label} 연결`);
  return { ctx, page };
}

const text = (page, sel) => page.locator(sel).first().innerText();

/* contenteditable 은 글이 두 줄로 접히면 End 키가 '그 줄 끝'까지만 갑니다.
   실제 사용자가 문장 끝을 누른 상황을 재현하려고 내용의 진짜 끝에 커서를 둡니다. */
async function caretToEnd(page, path){
  await page.evaluate(p => {
    const el = document.querySelector('[data-path="' + p + '"]');
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, path);
}

let browser;
try{
  browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  console.log(`\n방 코드: ${ROOM}\n`);

  /* ---------- 1. 두 사람이 같은 방에 접속 ---------- */
  const A = await openApp(browser, '남편');
  const B = await openApp(browser, '아내');
  ok('두 창 모두 같은 방에 접속하고 "연결됨" 표시');

  /* 초기 계획 내용이 그대로 보이는지 */
  assert.ok((await text(A.page, '#days')).includes('아융강'), '원본 일정 누락');
  assert.ok((await text(A.page, '#budget')).includes('217만원'), '원본 예산 누락');
  assert.ok((await text(A.page, '#total')).includes('만원'), '합계 계산 안 됨');
  assert.ok((await text(A.page, '#resorts')).includes('아쿠아토닉'), '리조트 목록 누락');
  assert.ok((await text(A.page, '#tips')).includes('그랩'), '현지 팁 누락');
  assert.ok((await A.page.locator('#dday').textContent()).includes('D-'), 'D-day 계산 안 됨');
  ok('원본 계획(일정·예산·리조트·팁·D-day)이 그대로 표시됨');

  /* ---------- 2. 아내 수정 → 남편 화면 ---------- */
  const tip0 = B.page.locator('[data-path="tips.0"]');
  await tip0.click();
  await B.page.keyboard.press('Control+a');
  await B.page.keyboard.type('아내가 고친 메모 ✅');
  await B.page.keyboard.press('Enter');            // Enter = 편집 종료
  await until(async () => (await text(A.page, '#tips')).includes('아내가 고친 메모'), '남편 화면 반영');
  ok('아내가 고친 내용이 남편 화면에 자동으로 나타남');

  /* ---------- 3. 남편 체크박스 → 아내 진행률 ---------- */
  const before = await B.page.locator('#chkCount').textContent();
  await A.page.locator('[data-toggle="0.0"]').click();
  await until(async () => (await B.page.locator('#chkCount').textContent()) !== before, '진행률 반영');
  const after = await B.page.locator('#chkCount').textContent();
  ok(`체크리스트 진행률이 양쪽에서 같이 움직임 (${before.trim()} → ${after.trim()})`);

  /* ---------- 4. 편집 중인 칸 보호 (핵심) ---------- */
  await caretToEnd(B.page, 'days.0.items.0.text');
  await B.page.keyboard.type(' — 아내가 쓰는 중');   // 아직 blur 안 함
  const caretBefore = await B.page.evaluate(() => {
    const el = document.activeElement, r = getSelection().getRangeAt(0);
    const pre = document.createRange(); pre.selectNodeContents(el);
    pre.setEnd(r.endContainer, r.endOffset);
    return { caret: pre.toString().length, len: el.textContent.length };
  });
  assert.equal(caretBefore.caret, caretBefore.len, '테스트 준비 실패: 커서가 문장 끝에 있지 않음');

  // 같은 섹션(일정)의 다른 칸을 남편이 고쳐서 보냄
  await caretToEnd(A.page, 'days.0.items.2.text');
  await A.page.keyboard.type(' — 남편 메모');
  await A.page.keyboard.press('Enter');

  // 아내 화면에 남편 수정이 도착해야 하고,
  await until(async () => (await text(B.page, '#days')).includes('남편 메모'), '아내 화면에 남편 수정 도착');

  // 그 순간에도 아내가 쓰던 글자와 커서가 살아 있어야 한다
  const survived = await B.page.evaluate(() => {
    const el = document.activeElement;
    const sel = window.getSelection();
    let caret = -1;
    if(el && sel && sel.rangeCount && el.contains(sel.getRangeAt(0).endContainer)){
      const r = sel.getRangeAt(0);
      const pre = document.createRange();
      pre.selectNodeContents(el);
      pre.setEnd(r.endContainer, r.endOffset);
      caret = pre.toString().length;
    }
    return {
      path: el && el.dataset ? el.dataset.path : null,
      html: el ? el.innerHTML : '',
      focused: !!(el && el.dataset && el.dataset.path === 'days.0.items.0.text'),
      caret,
      len: el ? (el.textContent || '').length : -1
    };
  });
  assert.equal(survived.focused, true, '편집 중이던 칸에서 포커스가 튕겨나갔음');
  assert.ok(survived.html.includes('아내가 쓰는 중'), '편집 중이던 글자가 덮어쓰기로 사라졌음');
  assert.equal(survived.caret, survived.len,
    `커서가 글자 끝(${survived.len})이 아니라 ${survived.caret} 위치로 튐`);
  ok('상대방 수정이 와도 내가 쓰던 칸의 글자·커서가 그대로 유지됨');

  // 아내가 편집을 마치면 두 수정이 모두 남아야 한다
  await B.page.keyboard.press('Enter');
  await until(async () => {
    const t = await text(A.page, '#days');
    return t.includes('아내가 쓰는 중') && t.includes('남편 메모');
  }, '두 수정이 모두 보존');
  ok('동시에 고친 두 사람의 수정이 둘 다 남아 있음');

  /* ---------- 5. 서로 다른 섹션 동시 수정 ---------- */
  await A.page.locator('[data-path="budget.4.c"]').click();
  await A.page.keyboard.press('Control+a');
  await A.page.keyboard.type('45~70만원');
  await B.page.locator('[data-path="bookings.3.t"]').click();
  await B.page.keyboard.press('Control+a');
  await B.page.keyboard.type('아융강 래프팅 (예약 완료)');
  await A.page.keyboard.press('Enter');
  await B.page.keyboard.press('Enter');
  await until(async () =>
    (await text(A.page, '#bookings')).includes('예약 완료)') &&
    (await text(B.page, '#budget')).includes('45~70만원'), '양쪽 섹션 반영');
  ok('서로 다른 섹션을 동시에 고쳐도 양쪽 수정이 모두 살아남음');

  /* 예산 범위("45~70만원") 자동 합계가 다시 계산되는지 */
  const total = await text(A.page, '#total');
  assert.ok(/\d[\d,]*~[\d,]*만원/.test(total), '범위 합계 계산 실패: ' + total);
  ok('"45~70만원" 같은 범위 표기도 합계에 반영됨 → ' + total.split('\n')[1]);

  /* ---------- 6. 통신이 끊겼다 붙는 상황 ---------- */
  await A.ctx.setOffline(true);
  await until(async () => (await A.page.locator('#status').textContent()).includes('연결 끊김'), '끊김 표시');
  ok('연결이 끊기면 "연결 끊김 — 다시 연결 중" 이라고 알려줌');

  await A.page.locator('[data-path="tips.1"]').click();
  await A.page.keyboard.press('Control+a');
  await A.page.keyboard.type('끊긴 동안 적은 메모');
  await A.page.keyboard.press('Enter');
  await sleep(1200);
  assert.ok((await text(A.page, '#tips')).includes('끊긴 동안 적은 메모'), '오프라인 편집이 화면에서 사라짐');

  await A.ctx.setOffline(false);
  await until(async () => (await A.page.locator('#status').textContent()).includes('연결됨'), '재연결');
  await until(async () => (await text(B.page, '#tips')).includes('끊긴 동안 적은 메모'), '끊겼을 때 쓴 내용 전송');
  ok('통신이 끊긴 동안 적은 내용도 다시 연결되면 상대방에게 전달됨');

  /* ---------- 7. 새로고침해도 남아 있는지 ---------- */
  await A.page.reload({ waitUntil: 'load' });
  await until(async () => (await A.page.locator('#status').textContent()).includes('연결됨'), '재접속');
  const afterReload = await text(A.page, '#tips');
  assert.ok(afterReload.includes('아내가 고친 메모'), '새로고침 후 내용 유실');
  assert.ok(afterReload.includes('끊긴 동안 적은 메모'), '새로고침 후 내용 유실');
  ok('새로고침해도 방 코드를 기억하고 내용이 그대로 남아 있음');

  /* ---------- 8. 항목 추가·삭제도 동기화되는지 ---------- */
  const tipsBefore = (await B.page.locator('#tips .li').count());
  await A.page.locator('[data-add="tip"]').click();
  await until(async () => (await B.page.locator('#tips .li').count()) === tipsBefore + 1, '추가 반영');
  A.page.once('dialog', d => d.accept());
  await A.page.locator('#tips .li').last().locator('.del').click();
  await until(async () => (await B.page.locator('#tips .li').count()) === tipsBefore, '삭제 반영');
  ok('+ 추가 / ✕ 삭제도 양쪽에 바로 반영됨');

  /* ---------- 9. 휴대폰에서 누르기 편한 크기인지 ---------- */
  const phone = await B.page.evaluate(() => {
    const hit = el => {                       // ::after 로 넓힌 실제 터치 범위
      const r = el.getBoundingClientRect();
      const a = getComputedStyle(el, '::after');
      const w = Math.max(r.width,  parseFloat(a.width)  || 0);
      const h = Math.max(r.height, parseFloat(a.height) || 0);
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w, h };
    };
    const one = (sel, name) => {
      const el = document.querySelector(sel);
      const b = hit(el);
      return { name, w: Math.round(b.w), h: Math.round(b.h) };
    };
    // 위아래로 붙어 있는 ✕ 두 개의 터치 범위가 겹치면 엉뚱한 항목이 지워진다
    const dels = [...document.querySelectorAll('#tips .del')].slice(0, 2).map(hit);
    const overlap = dels.length === 2
      ? (dels[0].cy + dels[0].h / 2) - (dels[1].cy - dels[1].h / 2)
      : -1;
    return {
      coarse: matchMedia('(pointer:coarse)').matches,
      targets: [
        one('#tips .del', '✕ 삭제 버튼'),
        one('.box', '체크박스'),
        one('.add', '+ 추가 버튼'),
        one('#backupBtn', '아래쪽 버튼')
      ],
      overlap: Math.round(overlap * 10) / 10,
      bodyFont: Math.round(parseFloat(getComputedStyle(document.body).fontSize)),
      inputFont: Math.round(parseFloat(getComputedStyle(document.querySelector('#roomInput')).fontSize)),
      footerGap: (() => {
        window.scrollTo(0, document.body.scrollHeight);
        const f = document.querySelector('footer').getBoundingClientRect();
        const b = document.querySelector('.bar').getBoundingClientRect();
        return Math.round(b.top - f.bottom);
      })(),
      docWidth: document.documentElement.scrollWidth,
      winWidth: window.innerWidth
    };
  });

  assert.equal(phone.coarse, true, '터치 기기로 인식되지 않아 확대 규칙이 적용되지 않음');
  for(const t of phone.targets){
    assert.ok(t.h >= 38 && t.w >= 38, `${t.name} 터치 영역이 ${t.w}×${t.h}px 로 작음`);
    console.log(`    · ${t.name} ${t.w}×${t.h}px`);
  }
  assert.ok(phone.overlap <= 0, `위아래 ✕ 버튼 터치 범위가 ${phone.overlap}px 겹침 — 오삭제 위험`);
  console.log(`    · 위아래 ✕ 버튼 간격 ${-phone.overlap}px (겹침 없음)`);
  assert.ok(phone.bodyFont >= 15, '본문 글자가 너무 작음');
  console.log(`    · 본문 글자 ${phone.bodyFont}px`);
  assert.ok(phone.inputFont >= 16, '입력칸 글자가 16px 미만이면 iOS 에서 화면이 확대됨');
  console.log(`    · 방 코드 입력칸 ${phone.inputFont}px (iOS 자동 확대 없음)`);
  assert.ok(phone.footerGap >= 0,
    `아래 고정 바가 본문 마지막 줄을 ${-phone.footerGap}px 가림`);
  console.log(`    · 본문 마지막 줄과 아래 바 사이 ${phone.footerGap}px 여유`);
  assert.ok(phone.docWidth <= phone.winWidth + 1,
    `가로 스크롤 발생 (문서 ${phone.docWidth}px > 화면 ${phone.winWidth}px)`);
  console.log(`    · 가로 스크롤 없음 (문서 ${phone.docWidth}px = 화면 ${phone.winWidth}px)`);
  ok('아이폰 폭 390px 기준 — 터치 영역·글자 크기·가로 스크롤 모두 문제 없음');

  await A.page.screenshot({ path: 'test-results/phone-husband.png', fullPage: false });
  await B.page.screenshot({ path: 'test-results/phone-wife.png', fullPage: true });

  console.log(`\n통과 ${pass.length}개 / 실패 0개\n`);
}catch(err){
  console.error('\n❌ 실패: ' + err.message + '\n');
  process.exitCode = 1;
}finally{
  if(browser) await browser.close();
  server.kill();
}
