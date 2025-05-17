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