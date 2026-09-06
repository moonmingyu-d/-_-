/* index.html 이 불러오는 기능이 실제 번들에 다 들어있는지 확인합니다.
   (사진 기능을 넣을 때 번들에 없는 기능을 불러와 앱 전체가 죽은 적이 있어 추가했습니다) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const html = readFileSync('public/index.html', 'utf8');
const m = html.match(/import \{([\s\S]*?)\} from '(\.\/vendor\/[\w.]+\.js)';/);

test('index.html 에 번들을 불러오는 줄이 있다', () => {
  assert.ok(m, 'import 문을 찾지 못함');
});

test('불러오는 번들 파일이 실제로 존재한다 (이름에 내용 지문 포함)', () => {
  const file = 'public/' + m[2].replace('./', '');
  assert.ok(existsSync(file), `${file} 이 없음 — npm run build:vendor 를 다시 실행하세요`);
  assert.match(m[2], /firebase\.[0-9a-f]{10}\.js$/,
    '번들 이름에 내용 지문이 없음 — 캐시된 옛 파일 때문에 앱이 죽을 수 있습니다');
});

test('index.html 이 쓰는 기능이 번들에 전부 들어있다', async () => {
  const wanted = m[1].split(',').map(x => x.trim()).filter(Boolean);
  const mod = await import(pathToFileURL('public/' + m[2].replace('./', '')).href);
  const missing = wanted.filter(n => typeof mod[n] === 'undefined');
  assert.deepEqual(missing, [], `번들에 없는 기능: ${missing.join(', ')}`);
  assert.ok(wanted.length >= 15, `불러오는 기능이 ${wanted.length}개뿐 — 파싱이 잘못됐을 수 있음`);
});

test('앱이 죽었을 때 알려주는 안전장치가 들어있다', () => {
  assert.ok(html.includes('window.__appReady = true'), '준비 표시가 없음');
  assert.ok(html.includes('앱을 불러오지 못했어요'), '안내 문구가 없음');
});
