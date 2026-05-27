# こんだてマン コーディング後チェックリスト

コーディング完了後、必ずこのファイルを読んで全項目を確認すること。
❌があればコーディングし直してから提出する。

---

## 【A】構文バランスチェック（必須）

```python
with open('App.jsx') as f: code = f.read()
in_str=False; str_char=''; b=0; br=0; p=0; i=0
while i<len(code):
    c=code[i]
    if in_str:
        if c=='\\': i+=1
        elif c==str_char: in_str=False
    else:
        if c in('"',"'",'`'): in_str=True; str_char=c
        elif c=='{': b+=1
        elif c=='}': b-=1
        elif c=='[': br+=1
        elif c==']': br-=1
        elif c=='(': p+=1
        elif c==')': p-=1
    i+=1
# b==0 and br==0 and p==0 であること
```

---

## 【B】依頼機能の確認
- [ ] 依頼された全機能が実装されているか
- [ ] 依頼されていない機能を変更・削除していないか

---

## 【C】仕様チェック

### API
- [ ] Anthropic APIを呼んでいないか（API不使用が大前提）
- [ ] `callAI` 等のAPI呼び出し関数が存在しないか

### データ構造
- [ ] `day_groups` は辞書形式か
- [ ] `dailyGoods` は文字列配列か
- [ ] `dishes` はオブジェクトか
- [ ] `ingredientMem` はトップレベルにあるか
- [ ] `pendingUpdate` フラグが存在するか

### plan構造
- [ ] `groups` の各要素に `days` / `lunch` / `dinner` があるか
- [ ] `lunch` に `name` / `cat` / `diff` があるか
- [ ] `dinner` に `name` / `sides` / `cat` / `diff` / `soup` があるか

### 献立生成
- [ ] `buildMenuFromDB` でDBから抽選しているか
- [ ] 重み付け抽選（`weightedRandom`）を使っているか
- [ ] `lastServed` によるローテーション除外があるか
- [ ] NG食材フィルターがあるか
- [ ] 副菜は週全体で重複しないか
- [ ] 冷凍食品強制適用が `frozen_meals` 設定に基づいているか
- [ ] `pendingUpdate=true` がセットされているか（献立変更時）

### 確定処理
- [ ] Step4コピー時に `lastServed` が更新されるか（`handleConfirm`）
- [ ] タブ移動時に `pendingUpdate` 確認ダイアログがあるか

### バリエーション
- [ ] `activeVariant` が `dishes` に保存されるか
- [ ] 食材取得で `activeVariant` を参照しているか（`getEffectiveIngredients`）
- [ ] 複数バリアントある場合のみバリエーション切替ボタンが表示されるか

### 買い物リスト
- [ ] `dishType` が `lunch_main` / `dinner_main` / `dinner_sideN` / `dinner_soup` か
- [ ] 調味料はデフォルト `excluded:true` か
- [ ] 同一食材名がマージされているか
- [ ] `sortMem` キーは食材名のみか（量を含まない）
- [ ] 長押しで量編集・1人前量保存ができるか

### DB管理
- [ ] 重複チェックが `ALL_MENU_NAMES` で行われているか
- [ ] `isCustom:true` がカスタム料理に付くか
- [ ] カテゴリ・meal・diff・バリアントが編集できるか

### UI
- [ ] タブは4つか（献立・評価・買い物・設定）
- [ ] 昼食・夕食両方がGroupCardに表示されるか
- [ ] Step4に昼夜両方が表示されるか
- [ ] 「LINEに貼付用コピー」ボタンのみか（送信ボタンはない）
- [ ] ローディング中にアイコン画像がズームインするか

### 設定
- [ ] ErrorBoundaryで設定画面がラップされているか
- [ ] Sheets連携が `/api/sheets.js` 経由か

### データ安全化
- [ ] `loadState` で `sanitizeState` が呼ばれているか
- [ ] Sheets読込時に `sanitizeState` が呼ばれているか

---

## 【D】破綻パターン確認
- [ ] 関数内コンポーネント定義をしていないか
- [ ] `.map()` 前に配列チェックがあるか
- [ ] `plan?.groups` などnullチェックがあるか
- [ ] `sess?.items` などnullチェックがあるか

---

## 【E】仕様書・SPEC.mdの更新
- [ ] 今回の変更がSPEC.mdに反映されているか
