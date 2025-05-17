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