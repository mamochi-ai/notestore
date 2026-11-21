// Generates synthetic (fictional) test fixtures. Usage: node tests/fixtures/make-fixtures.mjs <outdir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from '../../app/vendor/fflate.js';

const out = process.argv[2] || 'tests/.out';
mkdirSync(out, { recursive: true });

const head = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/"><channel><title>テスト書店主</title><link>https://note.com/example_test</link><description></description><wp:wxr_version>1.2</wp:wxr_version>`;
const item = ({ key, title, html, status = 'publish', date = '2026-01-01 10:00:00' }) => `<item><title><![CDATA[${title}]]></title><link>https://note.com/example_test/n/${key}</link><dc:creator><![CDATA[テスト]]></dc:creator><guid isPermaLink="false">${key}</guid><description></description><content:encoded><![CDATA[${html}]]></content:encoded><excerpt:encoded><![CDATA[]]></excerpt:encoded><wp:post_id>1</wp:post_id><wp:post_date>${date}</wp:post_date><wp:post_date_gmt>${date}</wp:post_date_gmt><wp:post_modified>${date}</wp:post_modified><wp:post_name>x</wp:post_name><wp:status>${status}</wp:status><wp:post_type>post</wp:post_type></item>`;
const tail = `</channel></rss>`;
const key = (i) => 'n' + (0x100000000000 + i).toString(16).slice(-12);

// 1000 articles, long titles / emoji / ascii mix
let big = head;
for (let i = 0; i < 1000; i++) {
  const t = i % 7 === 0 ? `🎁【テスト連載】とても長いタイトルの記事が続きます、どこまでも長く長く Vol.${i}〜副題もついています〜（配信日:2026年）`
    : i % 5 === 0 ? `English Title ${i} with ASCII words` : `記事 ${i}：日々の記録と小さな工夫`;
  big += item({ key: key(i), title: t, html: `<p>本文${i}。${'あいうえお'.repeat(40)}</p><p>2行目 12 と 345。</p>`, status: i % 50 === 0 ? 'draft' : 'publish', date: `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')} 10:00:00` });
}
writeFileSync(join(out, 'big-1000.xml'), big + tail);

// dangerous HTML
const evil = head + item({ key: key(9001), title: '危険なHTMLのテスト<script>window.__xss=1</script>', html:
  `<p>安全な段落</p><script>window.__xss=2</script><img src="x" onerror="window.__xss=3"><a href="javascript:window.__xss=4">悪いリンク</a>` +
  `<a href="https://note.com/ok">良いリンク</a><iframe src="https://evil.example/"></iframe><p style="color:red" onclick="window.__xss=5">style付き</p>` +
  `<svg><script>window.__xss=6</script></svg><object data="x"></object><form action="https://evil.example"><input name="a"></form>` +
  `<img src="https://tracker.example/pixel.gif"><math><mi xlink:href="javascript:alert(1)">x</mi></math><ruby>漢字<rt>かんじ</rt></ruby>` }) +
  item({ key: key(9002), title: '下書きの記事', html: '<p>非公開の下書き本文 SECRET_DRAFT_TEXT</p>', status: 'draft' }) +
  item({ key: key(9003), title: '状態不明の記事', html: '<p>状態不明 UNKNOWN_STATUS_TEXT</p>', status: 'weird' }) + tail;
writeFileSync(join(out, 'evil.xml'), evil);

// DOCTYPE / entity
writeFileSync(join(out, 'doctype.xml'), `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x "boom">]><rss><channel><item><title>&x;</title></item></channel></rss>`);
// broken XML
writeFileSync(join(out, 'broken.xml'), head + '<item><title>壊れ');
// broken ZIP
writeFileSync(join(out, 'broken.zip'), Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('garbage'.repeat(100))]));
// zip with traversal entry names + good xml + image referenced via encoded path
const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const k = key(7001);
const zipXml = head + item({ key: k, title: '画像つき記事 第1話', html: `<figure><img src="/assets/${k}_0123456789abcdef0123456789abcdef.png"></figure><p>見出し画像のある記事</p><figure><img src="./assets/%E7%94%BB%E5%83%8F.png"></figure>` }) +
  item({ key: key(7002), title: '画像つき記事 第2話', html: `<p>本文</p><figure><img src="/assets/missing.png"></figure>` }) + tail;
const files = {
  'note-test-1.xml': strToU8(zipXml),
  [`assets/${k}_0123456789abcdef0123456789abcdef.png`]: new Uint8Array(png1x1),
  'assets/画像.png': new Uint8Array(png1x1),
};
const z = zipSync(files);
writeFileSync(join(out, 'with-images.zip'), z);
// traversal: patch an entry name to ../../evil.txt by building raw zip with that name
const evilZip = zipSync({ 'note-test-1.xml': strToU8(zipXml), 'aaaaaaaaaaaaaaa.txt': strToU8('should be ignored'), [`assets/${k}_0123456789abcdef0123456789abcdef.png`]: new Uint8Array(png1x1) });
const buf = Buffer.from(evilZip);
let idx;
while ((idx = buf.indexOf('aaaaaaaaaaaaaaa.txt')) >= 0) buf.write('../../../evil.txt', idx, 'latin1'), buf.write('..', idx + 17, 'latin1');
writeFileSync(join(out, 'traversal.zip'), buf);
console.log('fixtures written to', out);
