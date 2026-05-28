# こんだてマン 仕様書
最終更新: 2026-05-27

---

## 基本方針
- **API不使用**（Anthropic API呼び出しなし）
- DBベースで献立生成・食材取得
- 評価が高いほど提案確率UP（重み付け抽選）
- こんだて野郎と完全独立した別リポジトリ・別Vercel

---

## デプロイ情報
- アプリ名: `こんだてマン`（定数 `APP_NAME` で管理）
- localStorageキー: `kondateman-v1`
- リポジトリ: GitHub / kondateman
- ファイル構成:
  - `src/App.jsx` / `src/main.jsx` / `src/menuDB.js`
  - `api/sheets.js`（SheetsプロキシAPI）
  - `public/manifest.json` / `public/icon-192.png` / `public/icon-512.png`
  - `index.html` / `package.json` / `vite.config.js`
  - `GoogleAppsScript.gs`（GASコード）
  - `SPEC.md` / `DOUBLECHECK.md` / `SKILL_MENU_ADDITION.md`
- 環境変数: なし（APIキー不要）

---

## タブ構成（BottomNav）
| タブ | アイコン | コンポーネント |
|---|---|---|
| 0 | 📅 献立 | MenuScreen |
| 1 | ⭐ 評価 | RatingScreen |
| 2 | 🛒 買い物 | ShopScreen |
| 3 | ⚙️ 設定 | SettingsScreen |

---

## データ構造（localStorageキー: `kondateman-v1`）

```js
{
  plan: {
    weekStart: "2026-05-27",
    groups: [
      {
        days: ["monday","wednesday","friday"],
        lunch: { name:"焼きそば", cat:"麺料理", diff:1 },
        dinner: {
          name:"生姜焼き", cat:"豚肉料理", diff:2,
          sides:["ひじきの煮物","冷奴"],
          soup: null  // or "豚汁" etc
        }
      }
    ]
  },
  session: {
    weekStart: "2026-05-27",
    items: [
      {
        id: "item_xxx",
        groupIdx: 0,
        dishType: "lunch_main" | "dinner_main" | "dinner_side1" | "dinner_side2" | "dinner_soup",
        dishName: "生姜焼き",
        name: "豚ロース",
        qty: "600g",
        type: "ingredient" | "seasoning",
        floor: "R" | "L" | null,
        excluded: false  // 調味料はデフォルトtrue
      }
    ],
    dailyGoods: [
      { id: "dg_xxx", name: "シャンプー", selected: true, floor: "R" | null }
    ]
  },
  sortMem: { "豚ロース": "R" },          // 食材名のみキー（量を含まない）
  ingredientMem: { "豚ロース": 150, "豚ロース_unit": "g" },  // 1人前量
  dailyGoods: ["シャンプー", ...],         // 文字列配列
  pendingUpdate: false,                    // 買い物リスト未更新フラグ
  dishes: {
    "生姜焼き": {
      scores: [4, 5],
      difficulty: 2,
      lastServed: "2026-05-27",
      recipeUrl: "https://...",
      activeVariant: "default",           // アクティブなバリエーションID
      variants: [...],                     // DB上書き用（空ならmenuDBを参照）
      cats: [...],                         // カテゴリ上書き用（任意）
      meal: "dinner",                      // meal上書き用（任意）
      isCustom: false                      // ユーザー追加の場合true
    }
  },
  settings: { ... }
}
```

### データの保管場所と共有方法
| データの種類 | 保管場所 | 共有方法 |
|---|---|---|
| 料理マスタ（menuDB.js） | GitHub | Vercelデプロイで全端末に自動反映 |
| 評価・lastServed・食材量 | localStorage | スプシ連携が必要 |
| カスタム追加した料理 | localStorage | スプシ連携が必要 |
| DB編集（食材・バリエーション） | localStorage | スプシ連携が必要 |

---

## データ安全化（sanitizeState）
全ロード時（localStorage・Sheets）に必ず実行：
- `dailyGoods` → 文字列以外を除去
- `dishes` → オブジェクトでなければ `{}`
- `ingredientMem` → オブジェクトでなければ `{}`
- `ng_foods` → 文字列以外を除去
- `sort_cats` / `recipe_sites` → 不正形式はデフォルト値
- `day_groups` → 配列形式なら辞書形式に変換

---

## menuDB（src/menuDB.js）

### フォーマット
フラット配列（カテゴリブロックなし）。追加は末尾の`];`の直前に1行追加するだけ。

```js
export const MENU_DB = [
  {
    name: "生姜焼き",
    cats: ["豚肉料理"],          // 最大2つ（カテゴリはcatsカラムで管理）
    meal: "dinner",              // "both" | "lunch" | "dinner"
    diff: 2,                     // 1=かんたん 2=ふつう 3=本格
    variants: [
      {
        variantId: "default",
        label: "デフォルト",
        recipeUrl: "",            // バリエーションごとのURL（任意）
        ingredients: [{ name:"豚ロース肉", qty:150, unit:"g" }],
        seasonings: [{ name:"醤油", qty:1, unit:"大さじ" }]
        // qty:0 は適量・少々
      }
    ]
  },
  // ← 追加はここに1行追記
];
```

### unitの選択肢
`g` / `ml` / `大さじ` / `小さじ` / `個` / `本` / `枚` / `束` / `缶` / `パック` / `かけ` / `片` / `適量` / `少々`

### ジャンル一覧と件数（2026-05-27時点: 639件）
| ジャンル | meal主な値 | 備考 |
|---|---|---|
| 鶏肉料理 | dinner | |
| 豚肉料理 | dinner | |
| 牛肉料理 | dinner | |
| 魚料理 | dinner | |
| 卵・豆腐料理 | both/dinner | |
| 麺料理 | lunch | |
| ご飯物 | lunch/both | カレー系もここ |
| 丼もの | both | |
| おかず | both | 副菜用 |
| スープ・汁物 | both | シチュー系もここ |
| その他 | dinner | お好み焼き等 |

※カレー・シチューカテゴリは廃止。カレー→ご飯物、シチュー→スープ・汁物に統合。

### エクスポート
```js
export const MENU_DB          // フラット配列
export const ALL_MENU_NAMES   // MENU_DB.map(m => m.name)（重複チェック用）
export const MENU_CATEGORIES  // [...new Set(MENU_DB.flatMap(m => m.cats))]（動的生成）
```

---

## menuDB 最小トークン更新手順 ★重要★

menuDB.jsは38万文字超のため、毎回全体を読み込むとトークンを大量消費する。
追加・修正の際は以下の手順で最小トークンで作業する。

### 料理を追加する場合
1. `ALL_MENU_NAMES` の末尾付近だけを確認して重複チェック
2. 追加する料理名・カテゴリ・食材をユーザーから受け取るか、こちらで生成
3. **ファイル末尾の `];` の直前に1行追記するだけ**（カテゴリブロック不要）
4. `menuDB.js` 全体は読まない。末尾の `];` 周辺数行だけ `view` で確認

### 件数確認だけする場合
```python
import re
with open('src/menuDB.js') as f: c = f.read()
for g in ['鶏肉料理','豚肉料理','牛肉料理','魚料理','卵・豆腐料理','麺料理','ご飯物','丼もの','カレー・シチュー','おかず','スープ・汁物','その他']:
    print(g, len(re.findall(r'"name":', c[c.find(f'"{g}": ['):c.find(f'"{g}": [')+50000])))
```

### 料理名を変更する場合
`str_replace` で該当行のみ変更。全体viewは不要。

---

## 献立生成ロジック（buildMenuFromDB）API不使用

### 抽選フロー
1. グループごとに昼食・夕食を独立して抽選
2. 昼食：`meal="lunch"` or `"both"` の麺料理・ご飯物・丼ものカテゴリから
3. 夕食メイン：`meal="dinner"` or `"both"` の肉・魚・卵豆腐・カレー・その他カテゴリから
4. 副菜：おかずカテゴリから設定数分（週全体重複なし）
5. 汁物：スープ・汁物カテゴリから（設定ありのグループのみ）

### 重み付け抽選
- スコア平均 ≥4.5 → 重み4倍
- スコア平均 ≥4.0 → 重み3倍
- スコア平均 ≥3.0 → 重み1.5倍
- スコアなし or <3.0 → 重み1倍
- 使いたい食材ワードにマッチ → 重みを追加で3倍

### 除外条件
- `lastServed` が rotationWeeks 週以内
- NG食材を含む料理

### 冷凍食品
`frozen_meals` 設定に基づき昼・夜それぞれ「冷凍食品」に強制上書き

### 確定タイミング
Step4「LINEに貼付用コピー」ボタン押下時に今週の全料理の `lastServed` を更新

---

## GroupCard

### 表示
- ヘッダー: グループ色 + 曜日ラベル + 「↕ 入替」ボタン
- ☀️ 昼食スロット（lunch_main）
- 🌙 夕食スロット（dinner_main）
- 副菜スロット（dinner_side1/2）
- 汁物スロット（dinner_soup）※設定ありのみ
- バリエーション名を小さく表示（複数バリアントある場合）
- ドラッグ＆ドロップで一品単位の入替

### 🔍ボタン → DishActionSheet
- レシピURL登録・表示
- レシピサイトで検索（Nadia/クックパッド/YouTube/Instagram）
- バリエーション切り替え（複数ある場合のみ表示）
- 変更オプション（展開式）:
  - メイン変更時: カテゴリ絞り込み（全カテゴリから選択可）
  - 副菜変更時: 使いたい食材フリーワード入力
- 📝 レシピDB編集（献立タブから該当料理の編集画面を直接開く）

### タブ移動時の確認
`pendingUpdate=true` の状態で他タブに移動 → 「買い物リストを更新しますか？」

---

## 買い物リスト

### Step1: 食材確認
- ingredient デフォルトON、seasoning デフォルトOFF
- 長押しで量を編集 → 1人前量をingredientMemに保存（推奨）or 今回だけ

### Step2: 日用品
- dailyGoods（文字列配列）をタグ表示・タップで選択

### Step3: 仕分けスワイプ
- マウント時にリストを確定（途中で変わらない）
- タッチスワイプ・ボタン両対応
- 戻る・全リセット

### Step4: 確認・送信
- 昼夜両方の献立・食材表示（調味料除外）
- 「📋 LINEに貼付用コピー（献立確定）」ボタン
  - クリップボードにコピー
  - 同時に今週の全料理の `lastServed` を更新

---

## 評価タブ
- 今週の全料理（昼食・夕食・副菜・汁物）を一覧表示
- ★1〜5評価 → `dishes[name].scores` に追加（直近10件保持）
- 難易度ボタン（かんたん/ふつう/本格）→ `dishes[name].difficulty` を更新

---

## レシピDB管理

### 設定タブのDBMenuEditor
1. テキスト入力で部分一致検索 → 候補リスト表示
2. 選択 → 編集シートが開く
3. 編集項目: カテゴリ（最大2つ）・提供タイミング・難易度・食材・調味料・バリエーション・バリエーションごとのURL
4. 保存 → `dishes[name]` に上書き（以降の全週に反映）

### 献立タブのDBMenuEditorInline
- 🔍 → 「📝 レシピDB編集」ボタンで該当料理の編集画面を直接開く（別BottomSheet）
- 設定タブに戻らず編集可能

### 新規追加
- 料理名を入力 → `ALL_MENU_NAMES` で重複チェック（同名があればエラー）
- `isCustom: true` で `dishes` に保存

### バリエーション
- 1料理に複数バリアントを持てる
- バリエーションごとにレシピURLを登録可能
- 切り替えは 🔍 → 「バリエーションを切り替える」から
- 切り替え後は `dishes[name].activeVariant` に保存
- 食材取得は `getEffectiveIngredients()` で activeVariant を参照

---

## 設定タブ
| セクション | 内容 |
|---|---|
| 📊 Googleスプレッドシート | GAS URL + トークン + 接続テスト + 今すぐ読み込み |
| 📅 曜日グループ | DayGroupEditor（辞書形式 {monday:1,...}） |
| ❄️ 冷凍食品 | FrozenMealsEditor（曜日×昼夜グリッド） |
| 🚫 NG食材 | NgFoodsEditor |
| 👨‍👩‍👧 1食の人数 | 1〜5人 |
| 🔄 ローテーション | 1〜6週 |
| 🍽 食事構成 | MealConfigEditor（昼夜×おかず品数・汁物） |
| ↔️ 仕分けカテゴリ | SortCatsEditor（最大4方向） |
| 🔍 レシピ検索サイト | サイト名編集 |
| 📖 レシピDB管理 | DBMenuEditor（検索・編集・新規追加） |
| 🧴 日用品リスト | 追加・削除 |
| 🗑️ データ管理 | 献立・買い物リストリセット |

---

## 曜日グループ（DayGroupEditor）
```js
// 辞書形式を厳守
day_groups: { monday:1, tuesday:2, wednesday:1, thursday:2, friday:1, saturday:3, sunday:4 }
```
- タップでGID+1。G7超えたらG1に戻る
- `deriveGroups()` でグループ配列に変換

---

## GAS設定（GoogleAppsScript.gs）
- 次のユーザーとして実行: **自分**
- アクセスできるユーザー: **Googleアカウントを持つ全員**
- アプリ→ `/api/sheets.js` プロキシ経由（CORS回避）
- 変更から2秒後に自動同期
- 別端末では「今すぐ読み込み」で取得
- **GAS URLは各端末で1回手動入力が必要**（スプシにURLは保存されないため）

---

## 開発ルール（必ず守ること）
1. 依頼されていない仕様・UIを絶対に勝手に変更・削除しない
2. ロジック的に動かなくなる場合のみ事前に許可を取る
3. コーディング前に必ずSPEC.mdとDOUBLECHECK.mdを読む
4. コーディング後はDOUBLECHECK.mdの全項目を確認する
5. `day_groups` は必ず辞書形式
6. str_replace前に必ずviewで確認
7. 修正方針を提示してOK後にコーディング
8. **menuDB.jsの更新は「最小トークン更新手順」に従う（全体読み込み禁止）**
