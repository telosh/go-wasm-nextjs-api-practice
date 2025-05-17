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

App Routerを使用してAPIエンドポイントを作成します。`app/api/calculate/route.ts` というファイルを作成し、以下の内容を記述します。

```TypeScript
// app/api/calculate/route.ts
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { webcrypto } from 'crypto'; // Node.js の crypto
import { performance as nodePerformance } from 'perf_hooks'; // Node.js の performance

// Wasm実行環境に必要なグローバルプロパティの型定義
interface GoWasmGlobal {
  Go: {
    new (): {
      importObject: WebAssembly.Imports;
      run(instance: WebAssembly.Instance): Promise<void>;
    };
  };
  goAdd: (a: number, b: number) => number | string;
  // Node.js環境では、crypto と performance は globalThis に既に存在しうるが、
  // Wasm実行や特定のライブラリが期待する型と異なる場合があるため、明示的に定義する。
  crypto?: typeof webcrypto; // Node.js の webcrypto と互換性のある型
  performance?: typeof nodePerformance; // Node.js の performance と互換性のある型
}

// Node.js環境でGo Wasmを実行するために必要なグローバルオブジェクトをセットアップ
// globalThis が GoWasmGlobal の形状を持つことを TypeScript に伝える
const g = globalThis as unknown as GoWasmGlobal;

if (typeof g.crypto === 'undefined') {
  // webcrypto API を globalThis.crypto に設定
  g.crypto = webcrypto;
}
if (typeof g.performance === 'undefined') {
  // performance API を globalThis.performance に設定
  // `as unknown as` は型互換性の問題を回避するために使用
  g.performance = nodePerformance as unknown as GoWasmGlobal['performance'];
}

// WasmモジュールのインスタンスとGoのランタイムインスタンスを保持する変数
let goRuntimeInstance: InstanceType<GoWasmGlobal['Go']>; // Goランタイムのインスタンス (go.runなどを呼び出すため)
let wasmInstance: WebAssembly.Instance | null = null; // WebAssemblyのインスタンス (実際のWasmモジュール)

/**
 * WebAssemblyモジュールを非同期で初期化します。
 * 既に初期化済みの場合は何もしません。
 * この関数は、Wasmモジュール内の 'goAdd' 関数が利用可能になるまで待機します。
 */
async function initializeWasm(): Promise<void> {
  if (wasmInstance) {
    console.log('Wasmは既に初期化されています。スキップします。');
    return;
  }
  console.log('Wasmモジュールを初期化しています...');

  try {
    // wasm_exec.js のパス解決と読み込み
    // このスクリプトはGoのWasmをブラウザやNode.jsで実行するためのランタイムを提供します。
    const wasmExecPath = path.resolve('./public/wasm_exec.js');
    const wasmExecContent = await fs.readFile(wasmExecPath, 'utf-8');
    // `new Function` を使ってグローバルスコープで wasm_exec.js を実行
    // これにより、globalThis.Go が定義されます。
    new Function(wasmExecContent)();

    // Goコンストラクタの存在確認
    if (typeof g.Go === 'undefined') {
      throw new Error("GoコンストラクタがglobalThis上で見つかりません。wasm_exec.jsの実行に失敗した可能性があります。");
    }
    goRuntimeInstance = new g.Go(); // Goランタイムの新しいインスタンスを作成

    // Wasmバイナリファイルのパス解決と読み込み
    const wasmFilePath = path.resolve('./public/main.go.wasm');
    const wasmBytes = await fs.readFile(wasmFilePath);

    // Wasmモジュールのインスタント化
    // WasmバイナリとGoランタイムのインポートオブジェクトを関連付けます。
    const result = await WebAssembly.instantiate(wasmBytes, goRuntimeInstance.importObject);
    wasmInstance = result.instance; // インスタント化されたWasmモジュールを保持

    console.log('Wasmモジュールがインスタント化されました。');

    // Goランタイムを開始し、Wasmモジュールを実行
    // これは非同期処理であり、完了を待たずに次の処理に進むことがあります。
    // Wasm内でのエラーはここでキャッチされます。
    goRuntimeInstance.run(wasmInstance).catch((err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("Go Wasmの実行時エラー:", errorMessage);
      wasmInstance = null; // エラー発生時はインスタンスを無効化
    });

    // 'goAdd'関数がグローバルスコープで利用可能になるまで待機
    // Wasmモジュールの初期化が完了し、Go側でエクスポートされた関数が使えるようになるのを待ちます。
    await new Promise<void>((resolve, reject) => {
      const timeout = 5000; // タイムアウト時間を5秒に設定
      const checkIntervalMs = 50;
      let elapsedTime = 0;

      const checkInterval = setInterval(() => {
        if (typeof g.goAdd === 'function') {
          clearInterval(checkInterval);
          console.log("'goAdd'関数が利用可能です。");
          resolve();
        } else {
          elapsedTime += checkIntervalMs;
          if (elapsedTime >= timeout) {
            clearInterval(checkInterval);
            console.error("タイムアウト: 'goAdd'関数が利用可能になりませんでした。");
            // Wasmの初期化に失敗したとみなし、インスタンスをクリアする
            wasmInstance = null;
            reject(new Error("タイムアウト: 'goAdd'関数の準備待機中にエラーが発生しました。Wasmモジュールの初期化に失敗した可能性があります。"));
          }
        }
      }, checkIntervalMs);
    });

    console.log('Go WasmがAPIルート用に初期化されました。');

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Wasm初期化中のエラー:', errorMessage);
    wasmInstance = null; // 初期化失敗時はインスタンスを無効化
    // エラーを再スローして、呼び出し元で処理できるようにする
    throw new Error(`Wasm初期化失敗: ${errorMessage}`);
  }
}

// APIリクエストを処理するPOSTハンドラ
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Wasmモジュールが初期化されているか、または 'goAdd' 関数が利用可能かを確認
    if (!wasmInstance || typeof g.goAdd !== 'function') {
      console.log("Wasmが未初期化または 'goAdd' が利用不可のため、初期化処理を実行します...");
      await initializeWasm(); // Wasmモジュールを初期化
    }

    // 初期化後、再度 'goAdd' 関数の存在を確認
    // initializeWasm内でエラーが発生した場合、wasmInstanceはnullになっているはず
    if (!wasmInstance || typeof g.goAdd !== 'function') {
      console.error("Wasmモジュールの準備ができていないか、'goAdd'関数が見つかりません（初期化試行後）。");
      return NextResponse.json(
        { error: "Wasmモジュールが利用できません。サーバー管理者にお問い合わせください。" },
        { status: 503 } // Service Unavailable
      );
    }

    // リクエストボディから計算する数値を取得
    const body = await request.json();
    const { a, b } = body;

    // 入力値の型チェック
    if (typeof a !== 'number' || typeof b !== 'number') {
      return NextResponse.json(
        { error: '無効な入力です。"a"と"b"は数値である必要があります。' },
        { status: 400 } // Bad Request
      );
    }

    // Wasmモジュール内の 'goAdd' 関数を呼び出し
    const result = g.goAdd(a, b);

    // Go側で不正な入力として処理された場合の対応 (例: "Invalid input: ...")
    if (typeof result === 'string' && result.startsWith("Invalid")) {
        return NextResponse.json({ error: result }, { status: 400 }); // Bad Request
    }

    // 計算結果をJSON形式でレスポンス
    return NextResponse.json({ result });

  } catch (error: unknown) {
    // API処理中に発生した予期せぬエラーのハンドリング
    const errorMessage = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    console.error('/api/calculate でのエラー:', errorMessage);
    // Wasm初期化エラーの場合、より具体的なメッセージを返す
    if (errorMessage.startsWith("Wasm初期化失敗:")) {
        return NextResponse.json(
            { error: 'Wasmモジュールの初期化に失敗しました。詳細はサーバーログをご確認ください。', details: errorMessage },
            { status: 500 } // Internal Server Error
        );
    }
    return NextResponse.json(
      { error: '内部サーバーエラーが発生しました。処理中に予期せぬ問題が発生しました。', details: errorMessage },
      { status: 500 } // Internal Server Error
    );
  }
}

// 開発環境でのホットリロード時にログを出力
// 注意: ホットリロードによりWasmモジュールの状態がリセットされることはないため、
// 複数回の初期化試行や状態の不整合に注意が必要です。
if (process.env.NODE_ENV === 'development') {
    console.log("APIルートモジュール (app/api/calculate/route.ts) が開発モードでリロードされました。Wasmの状態管理に注意してください。");
}
```

**コード解説:**

// TODO: コード解説 


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
{"error":"無効な入力です。\"a\"と\"b\"は数値である必要があります。"}
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