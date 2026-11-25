// 使い方（アプリ内ヘルプ）。ボタン名は画面の表記と一致させること。
import { h } from './util.js';
import { openModal, icon, btn } from './ui.js';

const P = (...t) => h('p', null, ...t);
const B = (t) => h('strong', { class: 'ui-name' }, t); // a button / label name as shown on screen
const steps = (...items) => h('ol', { class: 'help-steps' }, ...items.map((x) => h('li', null, ...[].concat(x))));
const tip = (...t) => h('p', { class: 'help-tip' }, ...t);

const OWNER = [
  {
    id: 'start', title: 'はじめに：この本屋でできること',
    body: () => [
      P('noteに書いてきた記事を、1冊ずつ本にして棚に並べるアプリです。表紙・背表紙・店主のPOPで、あなたの作品を見つけてもらう「本屋」をつくれます。'),
      steps(
        [h('b', null, '記事を読み込む'), '：noteで書き出したファイルを選ぶと、記事が本になって棚に並びます。'],
        [h('b', null, '本棚を整える'), '：棚の名前・本の並び・置き方を整えます。'],
        [h('b', null, '装丁する'), '：表紙や帯、POPで、本ごとに個性をつけます。'],
        [h('b', null, 'シェアする'), '：自己紹介記事に貼る画像やリンクを作ります。'],
      ),
      P('枠で囲んだ言葉（例：', B('シェア'), '）は、画面にあるボタンの名前です。'),
      tip('データはこの端末のブラウザの中だけに保存され、どこにも送信されません。API・ログインは不要です。'),
    ],
  },
  {
    id: 'import', title: '1. noteの記事を読み込む',
    body: () => [
      h('p', { class: 'help-sub' }, 'まず、noteで記事を書き出します'),
      tip('noteのアプリでは書き出せません。iPhone・iPadでも、SafariなどのブラウザでnoteのWebサイト（note.com）を開いて、ログインしてから行います。'),
      steps(
        ['右上の', h('b', null, 'プロフィールアイコン'), 'を押してメニューを開き、', h('b', null, '自分の記事'), 'を選びます。'],
        ['「自分の記事」の右上にある', h('b', null, 'エクスポート'), 'を押し、', h('b', null, 'エクスポートを開始'), 'を押します。'],
        ['noteから完了のメールが届くのを待ちます（3日以内に届きます）。その間、画面を閉じてもかまいません。'],
        ['完了メールの', h('b', null, 'ダウンロードページ'), 'を開き、', h('b', null, 'ダウンロード'), 'を押してZIPファイルを保存します。iPhone・iPadでは「ファイル」アプリの「ダウンロード」に入ります。'],
      ),
      tip('ダウンロードページはメールが届いてから7日間・3回まで使えます。過ぎたら、もう一度エクスポートしてください。'),
      h('p', null, h('a', { href: 'https://www.help-note.com/hc/ja/articles/16143464838681', target: '_blank', rel: 'noopener noreferrer' }, 'noteヘルプ「エクスポート機能の使い方」（画面つき）', icon('ext'))),
      h('p', { class: 'help-sub' }, '次に、この本屋で読み込みます'),
      steps(
        ['最初の画面の', B('noteの記事を読み込む'), '（本屋ができてからは上の', B('記事を読み込む'), '）を押し、保存したZIPを選びます。iPhone・iPadでは「ファイル」アプリから選べます。'],
        ['「記事の確認」で、本にする記事にチェックを入れて', B('選んだ○件を本にする'), 'を押します。公開記事は最初から選ばれ、下書きは選ばれていません。'],
        ['「整理の提案」で、連載のまとめや棚分けの候補から使うものだけ選びます。あとでいくらでも変えられます。'],
        'テーマ（本棚の雰囲気）を選ぶと、本屋のできあがりです。',
      ),
      tip('記事を書き足したら、もう一度同じ手順で読み込めます。新しい記事だけが追加され、装丁やPOP、並び順はそのまま残ります。'),
      tip('XMLファイルだけでも読み込めますが、画像は入りません（文字の表紙になります）。画像を使うならZIPのまま選んでください。'),
    ],
  },
  {
    id: 'shelf', title: '2. 本棚を整える',
    body: () => [
      steps(
        ['本をタップすると、右側（iPhoneでは下）に本の詳細が開きます。編集中はその下に編集の道具が並びます。'],
        [B('移動先'), 'で別の棚へ、', B('前へ'), '・', B('後ろへ'), 'で並び順を変えます。本を長押ししてドラッグしても並べ替えられます。'],
        [B('置き方'), 'で、背表紙・表紙・平積み・立てかけを選べます。'],
        [B('おすすめに飾る'), 'を押すと、棚の上の「初めての方へ」に3冊まで表紙向きで飾れます。'],
        ['上の', B('棚'), 'で、棚の名前（「夜中に作ったもの」など自由に）と順番を変えたり、棚を増やしたりできます。'],
        ['上の', B('本と連載'), 'で、複数の記事を1冊の連載・短編集にまとめられます。'],
      ),
      tip('棚の名前を押すと、その棚だけを表示できます。右上の虫めがねで本を探せます。'),
    ],
  },
  {
    id: 'design', title: '3. 1冊を装丁する',
    body: () => [
      P('本をタップして', B('装丁・POPを編集'), 'を押すと、左に見本を見ながら編集できます。最後に', B('保存'), 'を押してください。'),
      h('dl', { class: 'help-dl' },
        h('dt', null, '表紙'), h('dd', null, 'noteの見出し画像が標準の表紙です。本文の画像を選んだり、画像をアップロードしたりできます。画像は指でドラッグして位置を合わせます。'),
        h('dt', null, '背表紙'), h('dd', null, '表紙とは別の画像を使えます。表紙・背表紙に印刷する短い題名もここで変えられます。'),
        h('dt', null, '文字'), h('dd', null, '本のタイトル（正式な題名）と、表紙・背表紙に印刷する短い題名、文字の色や位置。'),
        h('dt', null, '色と素材'), h('dd', null, '本の色と、布・紙・革などの素材。'),
        h('dt', null, '紹介・おすすめ'), h('dd', null, '短い紹介文、「こんな人へ」、店主のおすすめ理由（棚のPOPにもなります）、帯の文字と色。'),
        h('dt', null, '読み方・公開'), h('dd', null, '縦書き・横書き、連載の分冊、有料部分の指定、公開用ZIPで本文を公開するかどうか。'),
      ),
      tip('入力しなかった項目は、本の詳細に表示されません。'),
    ],
  },
  {
    id: 'shop', title: '4. お店らしさを出す',
    body: () => [
      P('上の', B('お店の設定'), 'では、店名・店主名・自己紹介のほか、「お店らしさ」を設定できます。'),
      h('ul', { class: 'help-list' },
        h('li', null, B('看板・棚札の書体'), '：店名と棚札の書体。'),
        h('li', null, B('店主の印'), '：店主名から作る朱色の印。'),
        h('li', null, B('日焼け'), '：古い記事の本ほど背が褪せます。'),
        h('li', null, B('本の厚み'), '：「本文の文字数」にすると、長く書いた本ほど厚くなります。'),
        h('li', null, B('店の明かり'), '：見ている人の時刻で、朝・昼・夕方・夜に棚の光が変わります。'),
      ),
      P('本の詳細の', B('今月の一冊にする'), 'で、棚のいちばん上にその月の一冊を飾れます。添えることばは「お店の設定」で書きます。'),
      P('上の', B('テーマ'), 'で、本棚の雰囲気を6種類から変えられます。装丁の設定は消えません。'),
    ],
  },
  {
    id: 'read', title: '5. 本を読む',
    body: () => [
      steps(
        ['本の詳細で', B('この本を読む'), 'を押します。連載は目次の章を押すと、その章から開きます。'],
        ['縦書きは右から左へ、横書きは上から下へスクロールして読みます。'],
        ['上の', B('目次'), 'で章を移動、', B('表示'), 'で縦書き・横書き、文字の大きさ、行間を変えられます。'],
        [B('しおり'), 'で今の位置を残せます。次に開くと、前回の続きから表示されます。'],
        [B('棚へ戻る'), '（パソコンではEscキー）で本棚に戻ります。'],
      ),
    ],
  },
  {
    id: 'share', title: '6. シェアする',
    body: () => [
      P('上の', B('シェア'), 'から、3つの方法を選べます。どれも、本文は最初は入りません。下書きは共有できません。'),
      h('dl', { class: 'help-dl' },
        h('dt', null, 'A. 本棚の画像'), h('dd', null, '棚と店名を1枚の画像にします。iPhone・iPadでは画像を長押しして「写真に保存」。自己紹介記事に貼れます。'),
        h('dt', null, 'B. 紹介リンク'), h('dd', null, '本のタイトルやnoteのURLだけを入れたリンクです。サーバー不要ですぐ使えます。画像は届かないので、相手には文字の表紙で見えます。'),
        h('dt', null, 'C. 公開用ZIP'), h('dd', null, '装丁画像まで入った完全版です。GitHub Pagesなどに置く作業が別に必要です。'),
      ),
      P('公開前に', B('プレビュー'), 'を押すと、訪れた人からの見え方を確認できます。'),
    ],
  },
  {
    id: 'save', title: '7. 保存とバックアップ',
    body: () => [
      P('変更は自動で端末に保存されます（上の右端に「端末に保存済み」と出ます）。'),
      steps(
        ['ときどき', B('お店の設定'), '→', B('バックアップを書き出す'), 'で、ZIPを「ファイル」アプリなどに保存してください。'],
        ['別の端末に移すときや消えてしまったときは、最初の画面の', B('バックアップから復元する'), 'でそのZIPを選びます。'],
      ),
      tip('Safariの「履歴とWebサイトデータを消去」をすると、本屋のデータも消えます。バックアップを残しておくと安心です。'),
    ],
  },
  {
    id: 'trouble', title: '困ったときは',
    body: () => [
      h('dl', { class: 'help-dl' },
        h('dt', null, '表紙が文字だけになる'), h('dd', null, '見出し画像がない記事、見出し画像に「みんなのフォトギャラリー」の画像を使った記事（noteの書き出しに含まれません）、XMLだけで読み込んだ場合です。装丁編集の「表紙」で本文の画像を選ぶか、画像をアップロードしてください。'),
        h('dt', null, 'noteからのメールが届かない'), h('dd', null, '迷惑メールのフォルダも確認してください。3日たっても届かないときは、noteヘルプ「エクスポート機能のよくあるご質問」をご覧ください。'),
        h('dt', null, '題名が途中で「…」になる'), h('dd', null, '背表紙に入りきらない長さです。装丁編集の「背表紙」か「文字」で短い題名を付けてください。'),
        h('dt', null, '有料記事の本文が心配'), h('dd', null, 'noteの書き出しには有料記事の価格や試し読みライン（有料部分の位置）が入りません。装丁編集の「読み方・公開」で「ここから有料」の段落を選ぶと、公開用ZIPには手前までしか入りません。'),
        h('dt', null, '「保存できませんでした」と出る'), h('dd', null, '端末の空き容量が足りない可能性があります。不要な本や画像を減らし、バックアップを書き出してください。'),
        h('dt', null, '間違えて本を消した'), h('dd', null, '記事は残っています。上の「本と連載」の「本になっていない記事」から、もう一度本にできます。'),
      ),
    ],
  },
];

const VISITOR = [
  {
    id: 'v', title: 'この本屋の見かた',
    body: () => [
      steps(
        '気になる背表紙や表紙をタップすると、本の紹介が開きます。',
        ['棚の名前を押すと、その棚だけを表示できます。右上の虫めがねで本を探せます。'],
        [B('noteで読む'), 'を押すと、noteの記事が開きます。', B('この本を読む'), 'がある本は、ここでそのまま読めます。'],
        [B('店主'), 'を押すと、店主の自己紹介が見られます。'],
      ),
    ],
  },
];

/** @param {{audience?: 'owner'|'visitor', section?: string}} o */
export function openHelp({ audience = 'owner', section = null } = {}) {
  const list = audience === 'visitor' ? VISITOR : OWNER;
  const body = h('div', { class: 'help' },
    ...list.map((s, i) => {
      const d = h('details', { class: 'help-sec', open: (section ? s.id === section : i === 0) || null, id: `help-${s.id}` },
        h('summary', null, s.title), h('div', { class: 'help-body' }, ...s.body()));
      return d;
    }));
  const m = openModal({ title: audience === 'visitor' ? 'この本屋の見かた' : '使い方', body, wide: true, actions: [{ label: '閉じる', primary: true }] });
  if (section) requestAnimationFrame(() => { const el = m.el.querySelector(`#help-${section}`); if (el) el.scrollIntoView({ block: 'start' }); });
  return m;
}

// ---------- first-run guide card (owner) ----------
const KEY = 'bookshop:guide-dismissed';
export function guideDismissed() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
function dismiss() { try { localStorage.setItem(KEY, '1'); } catch { /* private mode: shows again next time */ } }

/** Small card shown above the shelf until the owner closes it. */
export function guideCard(onChange) {
  if (guideDismissed()) return null;
  const card = h('section', { class: 'guide-card', 'aria-label': 'はじめての方へ' },
    h('div', { class: 'guide-head' },
      h('strong', null, '本屋ができました。次はこの3つから'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'この案内を閉じる', onclick: () => { dismiss(); card.remove(); onChange && onChange(); } }, icon('close'))),
    h('ol', { class: 'guide-steps' },
      h('li', null, h('b', null, '本をタップ'), '　して「装丁・POPを編集」で、表紙や帯、おすすめ理由を入れる'),
      h('li', null, h('b', null, '「棚」'), 'で棚の名前を自分のことばに。本は「移動先」や長押しで並べ替え'),
      h('li', null, h('b', null, '「プレビュー」'), 'で見え方を確かめて、「シェア」で画像やリンクを作る')),
    h('div', { class: 'guide-foot' },
      btn('使い方をくわしく見る', () => openHelp({}), { cls: 'small', iconName: 'book' }),
      h('button', { type: 'button', class: 'link', onclick: () => { dismiss(); card.remove(); onChange && onChange(); } }, 'もう表示しない')));
  return card;
}
