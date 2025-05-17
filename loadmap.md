# ロードマップ: Go製WasmをNext.js App Routerで使用する

このロードマップでは、簡単な足し算を行うGoの関数をWebAssemblyにコンパイルし、Next.jsアプリケーションのサーバーサイド（Route Handler）から呼び出す例を作成します。

## 前提条件

*   **Go言語:** インストール済みであること (バージョン1.11以降、Wasmサポートのため)。
*   **Node.js:** インストール済みであること (Next.jsおよびWasm実行のため)。npmまたはyarnも利用可能であること。

## フェーズ1: GoによるWebAssemblyモジュールの準備

### 1. Goの作業ディレクトリ作成 (任意)

Next.jsプロジェクトとは別の場所でGoのコードを管理する場合、作業ディレクトリを作成します。

```bash
mkdir go-wasm-module
cd go-wasm-module
```

### 2. Goモジュールの初期化

Next.jsプロジェクトに直接Goのコードを含める場合は、このステップは必須ではありませんが、独立したGoモジュールとして管理する方が一般的なアプローチです。

```bash
go mod init example.com/go-wasm-module
```

### 3. Wasm用のGoコード作成

`main.go` というファイル名で以下のコードを作成します。このコードは、JavaScriptから呼び出せる `add` 関数を定義します。

```go
// main.go
package main

import (
	"fmt"
	"syscall/js"
)

// JavaScriptから呼び出される add 関数
func add(this js.Value, args []js.Value) interface{} {
	if len(args) != 2 {
		// エラーを返すか、より詳細なエラーオブジェクトを返すことを検討
		return js.ValueOf("Invalid number of arguments")
	}
	arg1, ok1 := 安全にIntに変換(args[0])
	if !ok1 {
		return js.ValueOf("Argument 1 is not a valid integer")
	}
	arg2, ok2 := 安全にIntに変換(args[1])
	if !ok2 {
		return js.ValueOf("Argument 2 is not a valid integer")
	}
	return js.ValueOf(arg1 + arg2)
}

// js.Valueを安全にintに変換するヘルパー関数
func 安全にIntに変換(val js.Value) (int, bool) {
	if val.Type() != js.TypeNumber {
		return 0, false
	}
	num := val.Int()
	// JavaScriptのNumberはfloat64なので、大きな数値や精度の扱いに注意
	return num, true
}

// JavaScriptに関数を登録する関数
func registerCallbacks() {
	js.Global().Set("goAdd", js.FuncOf(add))
	// Go側からJavaScriptに準備完了を通知するコールバックを設定することも可能
	// js.Global().Set("goWasmReady", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
	// 	fmt.Println("Go Wasm is ready to be called from JS!")
	// 	return nil
	// }))
}

func main() {
	c := make(chan struct{}, 0) // プログラムが終了しないようにチャネルを作成
	fmt.Println("Go WebAssembly Initialized (from Go)")
	registerCallbacks()

	// Goの初期化が完了したことをJavaScript側に通知する (オプション)
	// if js.Global().Get("onGoWasmReady").Type() == js.TypeFunction {
	// 	js.Global().Call("onGoWasmReady")
	// }

	<-c // main関数が終了するとWasmインスタンスも終了するため、待機させる
}
```

**コード解説:**

*   `syscall/js` パッケージを利用してJavaScriptとGo間でデータをやり取りします。
*   `安全にIntに変換` ヘルパー関数を追加し、JavaScriptからの入力値の型チェックを強化しました。
*   `js.Global().Set("goAdd", js.FuncOf(add))` で、Goの `add` 関数をJavaScript側のグローバルスコープに `goAdd` という名前で登録します。
*   `main` 関数内で `<-c` を使ってプログラムをブロックし、コールバックが呼ばれるのを待ちます。これにより、Wasmインスタンスが即座に終了するのを防ぎます。
*   コメントアウトされた部分で、GoからJavaScriptへ初期化完了を通知する仕組みの例を示しています。

### 4. GoコードをWebAssemblyにコンパイル

Goコードを `.wasm` ファイルにコンパイルします。出力先は、後で作成するNext.jsプロジェクトの `public` ディレクトリを指定すると便利です。ここでは仮に `public/main.go.wasm` とします。

**Linux/macOS (bashなど):**
```bash
GOOS=js GOARCH=wasm go build -o main.go.wasm main.go
```

**Windows (PowerShell):**
```powershell
$env:GOOS="js"; $env:GOARCH="wasm"; go build -o main.go.wasm main.go
# または、以下のように分けて実行も可能です
# $env:GOOS="js"
# $env:GOARCH="wasm"
# go build -o main.go.wasm main.go
```

*   `GOOS=js` と `GOARCH=wasm` は、JavaScript環境で動作するWebAssemblyバイナリを生成するための環境変数です。
*   `-o main.go.wasm` で出力ファイル名を指定します。

### 5. `wasm_exec.js` の準備

GoでコンパイルしたWasmを実行するには、GoのSDKに含まれる `wasm_exec.js` というJavaScriptファイルが必要です。このファイルは、Goのランタイム機能を提供し、WasmモジュールとJavaScript環境との間のブリッジとして機能します。

`wasm_exec.js` は、お使いのGoのインストールパスの `misc/wasm/wasm_exec.js` にあります。

**Goのインストールパスの確認方法:**

```bash
go env GOROOT
```

例えば、`/usr/local/go` や `C:\Go` などと表示されます。
このパスを元に `wasm_exec.js` を見つけ、後でNext.jsプロジェクトの `public` ディレクトリにコピーします。

例:
```bash
cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" ./ # カレントディレクトリにコピーする場合
```

## フェーズ2: Next.js (App Router) プロジェクトのセットアップと統合

### 1. Next.jsプロジェクトの作成

`npx` を使って新しいNext.jsプロジェクトを作成します。ここでは `my-go-wasm-app` というプロジェクト名にします。

```bash
npx create-next-app@latest my-go-wasm-app
```

プロジェクト作成時の質問には適宜答えてください（TypeScriptを使用するかどうかなど。この例ではJavaScriptを前提とします）。

### 2. プロジェクトディレクトリへ移動

```bash
cd my-go-wasm-app
```

### 3. Wasm関連ファイルの配置

#### a. `main.go.wasm` の配置

フェーズ1でコンパイルした `main.go.wasm` ファイルを、Next.jsプロジェクトの `public` ディレクトリにコピーまたは移動します。

```bash
# public ディレクトリが存在しない場合は作成
mkdir -p public

# (go-wasm-module ディレクトリから main.go.wasm をコピーする場合の例)
# cp ../go-wasm-module/main.go.wasm ./public/

# (もしくは、最初から public ディレクトリに出力していればこの手順は不要)
# 例: GOOS=js GOARCH=wasm go build -o my-go-wasm-app/public/main.go.wasm main.go (プロジェクト作成前に実行した場合)
```
Goプロジェクトのルートでビルドした場合、生成された `main.go.wasm` を `my-go-wasm-app/public/` にコピーしてください。

#### b. `wasm_exec.js` の配置

フェーズ1で準備した `wasm_exec.js` ファイルを、Next.jsプロジェクトの `public` ディレクトリにコピーします。

```bash
cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" ./public/
```

最終的に `public` ディレクトリは以下のようになっているはずです:

```
my-go-wasm-app/
├── public/
│   ├── main.go.wasm
│   └── wasm_exec.js
│   └── (その他 Next.js のデフォルトファイル like next.svg, vercel.svg)
└── ... (その他のプロジェクトファイル)
```

### 4. Route Handler の作成

App Routerを使用してAPIエンドポイントを作成します。`app/api/calculate/route.js` というファイルを作成し、以下の内容を記述します。

```javascript
// app/api/calculate/route.js
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// Node.js環境でGo Wasmを実行するために必要なグローバルオブジェクトをセットアップ
// wasm_exec.js が期待するオブジェクトを最小限用意する
// Node.js v19以降では global.crypto が標準で利用可能ですが、それ以前のバージョン向け
if (typeof global.crypto === 'undefined') {
  const crypto = require('crypto');
  global.crypto = crypto.webcrypto;
}
if (typeof global.performance === 'undefined') {
  const { performance } = require('perf_hooks');
  global.performance = performance;
}
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = require('util').TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = require('util').TextDecoder;
}

// グローバルスコープにGoインスタンスとWasmモジュールをキャッシュ
// これにより、リクエスト間で初期化処理をスキップできる
let goInstance;
let wasmModule; // コンパイル済みWasmモジュール (インスタンス化に使用)
let wasmInstance; // Wasmインスタンス (Goプログラムを実行)

// Wasmモジュールの初期化関数
async function initializeWasm() {
  if (wasmInstance) {
    console.log('Wasm already initialized. Skipping.');
    return; // 既に初期化済み
  }
  console.log('Initializing Wasm module...');

  try {
    // Node.js環境でwasm_exec.jsを読み込むための準備
    // wasm_exec.jsはグローバルにGoオブジェクトを作成する
    const wasmExecPath = path.resolve('./public/wasm_exec.js');
    const wasmExecContent = await fs.readFile(wasmExecPath, 'utf-8');

    // Node.jsのグローバルスコープでwasm_exec.jsを実行する
    // これにより global.Go が定義される
    // new Function(code)() は eval と同様の挙動だが、セキュリティリスクを考慮し、
    // 信頼できるコードでのみ使用すること。
    // vmモジュールを使用する方がより安全な場合がある。
    new Function(wasmExecContent)();

    goInstance = new global.Go(); // global.Go は wasm_exec.js によって定義される

    const wasmFilePath = path.resolve('./public/main.go.wasm');
    const wasmBytes = await fs.readFile(wasmFilePath);

    // Wasmモジュールをコンパイル・インスタンス化
    const result = await WebAssembly.instantiate(wasmBytes, goInstance.importObject);
    wasmModule = result.module;
    wasmInstance = result.instance;

    console.log('Wasm module instantiated.');

    // Goプログラムのmain関数を実行し、コールバック登録などを完了させる
    // このPromiseはGoプログラムが終了するまで解決されないため、
    // バックグラウンドで実行させ、完了を待たずに処理を進める。
    goInstance.run(wasmInstance).catch(err => {
      console.error("Go Wasm execution error:", err);
      // エラー発生時はインスタンスを無効化し、再初期化を促す
      wasmInstance = null;
      goInstance = null;
    });

    // Goの関数が登録されるのを待つ。
    // より堅牢な方法としては、Go側から準備完了をJavaScriptに通知するコールバックを使用する。
    // (例: Go側で js.Global().Call("onGoWasmReady") を呼び出す)
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (global.goAdd) {
          clearInterval(checkInterval);
          console.log('goAdd function is available.');
          resolve();
        }
      }, 50); // 50msごとに確認
      setTimeout(() => { // タイムアウト処理
        clearInterval(checkInterval);
        if (!global.goAdd) {
            console.error("Timeout: goAdd function did not become available.");
        }
        resolve(); // タイムアウトでもPromiseを解決して処理を続ける (エラー処理は呼び出し元で行う)
      }, 2000); // 2秒のタイムアウト
    });


    console.log('Go Wasm Initialized for API.');

  } catch (error) {
    console.error('Error during Wasm initialization:', error);
    // 初期化失敗時はインスタンスをクリア
    wasmInstance = null;
    goInstance = null;
    throw error; // エラーを呼び出し元に伝える
  }
}

// アプリケーション起動時に一度だけWasmを初期化する (推奨)
// initializeWasm().catch(err => {
//   console.error("Failed to initialize Wasm on startup:", err);
//   // 必要に応じてここでアプリケーションを終了するなどの処理を行う
// });


// Route Handler (POSTメソッドを処理)
export async function POST(request) {
  try {
    // リクエストごとに初期化を試みる (開発時や、サーバーレス環境でのコールドスタート時など)
    // 本番環境では、サーバー起動時に一度だけ初期化する方が効率的
    if (!wasmInstance) {
        await initializeWasm();
    }

    if (!wasmInstance || typeof global.goAdd !== 'function') {
        console.error("Wasm instance or goAdd function not available.");
        return NextResponse.json({ error: 'Wasm module not ready or goAdd not found' }, { status: 503 }); // Service Unavailable
    }

    const body = await request.json();
    const { a, b } = body;

    if (typeof a !== 'number' || typeof b !== 'number') {
      return NextResponse.json({ error: 'Invalid input. "a" and "b" must be numbers.' }, { status: 400 });
    }

    // JavaScriptからGoの関数を呼び出す
    // 'goAdd' は main.go で js.Global().Set() を使って登録した名前
    const result = global.goAdd(a, b);

    // Go関数からの戻り値の型を確認 (エラーメッセージの可能性もあるため)
    if (typeof result === 'string' && result.startsWith("Invalid")) {
        return NextResponse.json({ error: result }, { status: 400 });
    }


    return NextResponse.json({ result });

  } catch (error) {
    console.error('Error in /api/calculate:', error);
    // initializeWasm 内でエラーがスローされた場合もここでキャッチされる
    return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
  }
}

// 開発サーバーのホットリロードに関する注意点
// Next.jsの開発モードでは、ファイル変更時にモジュールが再評価されることがあります。
// グローバルにキャッシュされた wasmInstance や goInstance が古い状態のままになるか、
// 意図せず再初期化される可能性があるため、注意が必要です。
// initializeWasm 内の `if (wasmInstance)` チェックが重要になります。
if (process.env.NODE_ENV === 'development') {
    console.log("API route module (app/api/calculate/route.js) reloaded in development. Ensure Wasm state is managed correctly.");
}
```

**コード解説:**

*   **グローバルオブジェクトのセットアップ:** `wasm_exec.js` はブラウザ環境を前提としているため、Node.js環境で不足しているグローバルオブジェクト (`crypto`, `performance`, `TextEncoder`, `TextDecoder`) を事前に定義しています。Node.jsのバージョンによって必要なものが変わる可能性があります。
*   **`wasm_exec.js`の実行:** `fs.readFile`で`wasm_exec.js`を読み込み、`new Function(code)()` を使ってグローバルスコープで実行します。これにより `global.Go` クラスが利用可能になります。
    *   **注意:** `eval` や `new Function(code)()` の使用はセキュリティリスクを伴う可能性があります。信頼できるコードでのみ使用してください。より安全な代替手段としてNode.jsの `vm` モジュールを検討することもできますが、ここでは簡潔さを優先しています。
*   **`initializeWasm` 関数:**
    *   Wasmモジュールと `wasm_exec.js` を読み込み、Goのランタイムを初期化します。
    *   `WebAssembly.instantiate(wasmBytes, goInstance.importObject)` でWasmモジュールをインスタンス化します。`goInstance.importObject` は `wasm_exec.js` が提供する、GoがJavaScriptの機能を使うために必要なオブジェクトです。
    *   `goInstance.run(wasmInstance)` を呼び出すことで、Goの `main` 関数が実行され、`registerCallbacks` が呼び出されて `goAdd` 関数がJavaScript側にエクスポートされます。この `go.run` はPromiseを返し、Goプログラムが終了するまで解決されません。非同期に実行させます。
    *   インスタンス化はコストがかかるため、`wasmInstance` と `goInstance` をグローバル変数にキャッシュして、初回リクエスト時またはサーバー起動時に一度だけ実行するようにしています。
    *   `goAdd` 関数が利用可能になるまでポーリングで待機するロジックを追加し、タイムアウト処理も入れています。より堅牢なのはGo側からの通知です。
*   **`POST` ハンドラ:**
    *   リクエストボディから `a` と `b` を受け取ります。
    *   `initializeWasm()` を呼び出し、Wasmモジュールが初期化されていることを保証します。
    *   `global.goAdd(a, b)` のようにして、Goで定義しJavaScriptにエクスポートされた `goAdd` 関数を呼び出します。
    *   Go関数がエラーメッセージ（文字列）を返した場合のハンドリングを追加しました。
    *   結果をJSONで返します。
*   **初期化戦略:** コメントアウトされている `initializeWasm().catch(...)` の部分は、アプリケーション起動時にWasmを初期化するアプローチです。これは本番環境では推奨されます。現在の実装ではリクエスト毎に初期化チェックを行っています。

## フェーズ3: 動作確認と発展

### 1. 開発サーバーの起動

Next.jsの開発サーバーを起動します。

```bash
npm run dev
# または
yarn dev
```

サーバーが `http://localhost:3000` で起動します。

### 2. API Routeのテスト

`curl`やPostmanなどのツールを使って、作成したAPIエンドポイントにPOSTリクエストを送信します。

```bash
curl -X POST -H "Content-Type: application/json" -d '{"a": 15, "b": 7}' http://localhost:3000/api/calculate
```

**期待されるレスポンス:**

```json
{"result":22}
```

無効な入力を試す:
```bash
curl -X POST -H "Content-Type: application/json" -d '{"a": "hello", "b": 7}' http://localhost:3000/api/calculate
```
期待されるレスポンス (Go側のエラーハンドリングによる):
```json
{"error":"Argument 1 is not a valid integer"}
```

コンソールには "Go WebAssembly Initialized (from Go)" や "Go Wasm Initialized for API."、"goAdd function is available." などのログが表示されるはずです。

## 発展的な考慮事項

*   **エラーハンドリングの強化:**
    *   GoのWasm関数内で発生したエラーを、より構造化された形でJavaScript側に伝え、APIレスポンスとして返す仕組みを強化します。Go側では `panic` ではなく、エラー情報を含むオブジェクトや複数の戻り値を返すように設計すると、JavaScript側で扱いやすくなります。
    *   JavaScript側でのタイムアウト処理、Wasmモジュールの初期化失敗時のリトライ戦略なども検討します。

*   **複雑なデータ型の扱い:**
    *   文字列、配列、構造体（オブジェクト）などをGoとJavaScript間でやり取りする場合、`syscall/js` の機能をより深く理解し、適切に型変換を行う必要があります。
    *   大きなデータや複雑な構造を持つデータは、JSON文字列にシリアライズ/デシリアライズして交換する方法が一般的で、メモリ管理の観点からも有利な場合があります。 `js.ValueOf(string)` や `js.Value.String()` を活用します。

*   **パフォーマンス最適化:**
    *   **初期化コスト:** `initializeWasm` は、サーバーレス環境でなければ、アプリケーション起動時に一度だけ実行されるように設計するのが理想的です (例: Next.jsのカスタムサーバーや、グローバルセットアップファイル内、あるいは `route.js` のトップレベルで即時実行関数として呼び出すなど)。Route Handler内でリクエスト毎に初期化チェックを行う現在の実装は、同時多発リクエストへの対応や初期化中のリクエストキューイングなどを考慮する必要があります。
    *   **メモリ管理:** GoのWasmは独自のガベージコレクションを持ちますが、JavaScriptとの間で大きなデータを頻繁にやり取りする場合はメモリコピーのオーバーヘッドに注意が必要です。`js.CopyBytesToGo` や `js.CopyBytesToJS` といった関数を効率的に使用するか、前述のJSONシリアライズを検討します。
    *   **Wasmモジュールのサイズ:** Goで生成されるWasmバイナリは比較的小さくありません。不要なパッケージのインポートを避けたり、TinyGoのような代替コンパイラを検討することで、ファイルサイズを削減できる場合があります（ただし、TinyGoは `syscall/js` の互換性に制限がある場合があります）。

*   **`wasm_exec.js` の代替/改良:**
    *   `wasm_exec.js` はブラウザ環境を主眼に置いているため、Node.js専用のより軽量なローダーや、Wasmモジュール自体に最低限のランタイムを組み込むアプローチ (TinyGoなど) も長期的には検討の余地があります。ただし、標準のGoコンパイラを使用する場合、`wasm_exec.js` が基本的な選択肢となります。

*   **セキュリティ:**
    *   `new Function(wasmExecContent)()` の使用は、`wasm_exec.js` の内容が改ざんされていないことを前提としています。ソースを信頼できない場合、より安全な実行方法 (Node.jsの `vm` モジュールの隔離されたコンテキストなど) を検討すべきです。
    *   Wasmモジュールに渡す入力値の検証は、JavaScript側とGo側の両方で行うことが望ましいです（二重検証）。

*   **デプロイ:**
    *   VercelやAWS Lambdaなどのプラットフォームにデプロイする際、`public` ディレクトリ内の `.wasm` ファイルと `wasm_exec.js` が正しくデプロイパッケージに含まれ、サーバー環境で読み取り可能であることを確認してください。
    *   サーバーレス環境では、コールドスタート時のWasm初期化時間がAPIの応答時間に影響を与える可能性があります。初期化済みのインスタンスを維持する戦略（プロビジョンドコンカレンシーなど）や、Wasmモジュールのサイズ削減、初期化処理の高速化が重要になります。

*   **GoからJavaScriptへのより高度な連携:**
    *   Goから非同期にJavaScript関数を呼び出したり、JavaScript側でPromiseを待機したりすることも可能です。
    *   Goのgoroutineとチャネルを活用して、バックグラウンドタスクを実行し、結果をJavaScriptに通知するような複雑な処理も実装できます。

このロードマップが、GoとNext.jsを用いたWebAssembly活用の第一歩となれば幸いです。