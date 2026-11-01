// cli のテストは analyze を何度も走らせる。本物の LLM コマンド（既定は claude -p）を起動しないよう、偽コマンドに向ける。
// analyze の解決順は 引数（UI の設定）> ONDINA_LLM_COMMAND > yaml > 既定 なので、テストが引数で上書きすれば個別の偽コマンドも使える
import path from 'node:path';

process.env['ONDINA_LLM_COMMAND'] = `node ${path.resolve(import.meta.dirname, 'fake-llm.mjs')}`;

// LSP も同じ。本物の kotlin-lsp（展開後 1.1 GB・冷えた起動は 59 秒）を、入っている開発機でも起動しない。
// 解決順は ONDINA_LSP_COMMAND > yaml の lsp.<language>.command > kotlin-lsp の置き場。値は実行ファイルのパス 1 本。
// 置き場（既定 ~/.local/share/kotlin-lsp）は無い場所に向ける。ONDINA_LSP_COMMAND を消すテストでも、開発機に入っている本物を拾わない
process.env['ONDINA_LSP_COMMAND'] = path.resolve(import.meta.dirname, 'fake-lsp.mjs');
process.env['ONDINA_LSP_DIR'] = path.resolve(import.meta.dirname, 'no-kotlin-lsp');
