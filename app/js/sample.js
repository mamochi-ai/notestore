// Fictional sample shop (not real note data, no URLs). Used for "サンプルの本屋を見る".
import { newBook } from './state.js';

const P = (...lines) => lines.map((l) => `<p>${l}</p>`).join('');

const ARTICLES = [
  ['s1', 'パソコンなしで、作ってみた。', P('手元にあるのはiPadだけでした。', 'それでも、作りたいものがありました。最初の一行を書くまでに三日かかりました。', '画面の小ささは、思ったほど問題ではありませんでした。問題は、「どうせ無理だ」という気持ちのほうでした。')],
  ['s2', 'はじめてのアプリ', P('ボタンをひとつ押すと、今日の日付が表示されるだけのアプリです。', 'それだけなのに、動いた瞬間、声が出ました。')],
  ['s3', '作っては、やめて。また作る。', P('途中でやめたものが、フォルダにたくさんあります。', 'やめたことは失敗ではなく、次に作るための材料だったのだと、最近は思うようになりました。')],
  ['s4', '小さな工夫', P('ショートカットをひとつ作るだけで、朝の五分が浮きます。', '五分あれば、お茶が一杯いれられます。')],
  ['s5', '雨の日の記録', P('窓の外で、雨が静かに降っていました。', '今日は少しだけ、立ち止まってみます。')],
  ['s6', '好きなもの', P('古い文房具、雨上がりの匂い、誰かの手書きのメモ。', '好きなものを並べてみると、自分の輪郭が少しだけ見えてきます。')],
  ['s7', '台所の音', P('朝の台所には、決まった順番の音があります。', 'やかん、まな板、トースター。')],
  ['s8', '旅の途中 第1話 知らない駅', P('小さな駅で降りると、知らない風が吹いていました。', '改札の向こうに、古い本屋の看板が見えました。「本日、開店」。手書きの文字でした。')],
  ['s9', '旅の途中 第2話 本屋の扉', P('翌朝、古い本屋の扉を開けました。', '「いらっしゃい」。店主は顔を上げずに、そう言いました。棚には、背表紙のない本ばかりが並んでいました。')],
  ['s10', '旅の途中 第3話 背表紙のない本', P('「名前のない本は、読んだ人が名前をつけるんですよ」', '店主はそう言って、一冊を差し出しました。表紙には、雨の日の窓が描かれていました。', '──第三話・了')],
  ['s11', '夜の散歩', P('22時の商店街は、昼間とは別の顔をしています。', 'シャッターに描かれた絵を、ひとつずつ見て歩きました。')],
  ['s12', '続けるための、やめ方', P('毎日書くのをやめたら、週に3回は書けるようになりました。')],
];

export function sampleData() {
  const now = Date.now();
  const articles = ARTICLES.map(([id, title, html], i) => ({
    id, title, html, url: null, status: 'sample', date: new Date(now - (ARTICLES.length - i) * 86400000 * 5).toISOString(),
    images: [], headImageId: null, source: 'sample',
  }));
  const shop = {
    key: 'shop', schema: 1, name: '小さな物語書店', tagline: '書いてきたことが、一冊ずつ並ぶ場所。',
    owner: '架空の店主', intro: 'これはサンプルの本屋です。\n実在の記事ではありません。あなたのnoteの記事を読み込むと、ここがあなたの本屋になります。',
    profileUrl: '', avatarImageId: null, theme: 'warm',
    featured: ['bk2', 'bk5', 'bk8'], featuredPop: 'まず読んでほしい3冊',
    shelves: [{ id: 'make', name: 'ものづくり' }, { id: 'life', name: '暮らしと日々' }, { id: 'trip', name: '旅' }, { id: 'unsorted', name: '未分類' }],
  };
  const B = (id, art, shelf, order, extra = {}) => newBook({ id, title: articles.find((a) => a.id === art).title, articleIds: [art], shelfId: shelf, order, ...extra });
  const books = [
    B('bk1', 's1', 'make', 1, { face: 'cover', pop: 'この記事から、\n全部始まりました。', blurb: 'iPadだけで、最初のひとつを作ってみた記録（架空のサンプル）。', forWhom: '作りたいものはあるけど、最初の一歩で止まっている人へ', design: { ...newBook({}).design, motif: 'tablet' } }),
    B('bk2', 's2', 'make', 2),
    B('bk3', 's3', 'make', 3, { pop: '何度でも、また作る。', popOnShelf: false, blurb: 'うまくいかなかった日も、残しておこう。そう思って書いた一冊です。', forWhom: '途中でやめたものが、フォルダにたまっている人へ', design: { ...newBook({}).design, color: '#b45f43', motif: 'notebook' } }),
    B('bk4', 's4', 'make', 4),
    B('bk5', 's5', 'life', 1, { design: { ...newBook({}).design, color: '#2e4566', motif: 'rain' } }),
    B('bk6', 's6', 'life', 2, { face: 'cover', pop: 'あまり読まれてないけど、\n好きな一本', design: { ...newBook({}).design, color: '#efe8d8', motif: 'sprig' } }),
    B('bk7', 's7', 'life', 3),
    B('bk9', 's11', 'life', 4),
    B('bk10', 's12', 'make', 5),
    newBook({ id: 'bk8', title: '旅の途中', articleIds: ['s8', 's9', 's10'], kind: 'serial', mode: 'novel', writing: 'vertical', shelfId: 'trip', order: 1, seriesStatus: 'ongoing', blurb: '知らない駅で降りた「わたし」が、背表紙のない本ばかりの本屋に出会う連載小説（架空のサンプル）。', forWhom: '静かな物語を、少しずつ読みたい人へ', pop: '第1話の最後の一行が好きです', design: { ...newBook({}).design, color: '#e6dcc4', motif: 'mountain', titleWriting: 'vertical' } }),
  ];
  return { shop, articles, books, images: [] };
}
