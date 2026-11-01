// Tab 補完のスクリプト（`ondina completion zsh`）。scripts/install.sh が ~/.zsh_functions/_ondina に置く。
// サブコマンドの一覧は使い方（main.ts の usage）と揃える。揃っているかは test/completion.test.ts で見る。

export const SUBCOMMANDS: readonly { name: string; summary: string }[] = [
  { name: 'analyze', summary: 'PR か 2 つの ref を解析して Analysis.json に書き出す' },
  { name: 'serve', summary: 'ローカル UI を起動する' },
  { name: 'structure', summary: 'リポジトリ全体の構成（層）を推定し直す' },
  { name: 'list', summary: '解析済みの PR を一覧表示する' },
  { name: 'comments', summary: 'AI エージェントのコメント下書きを受け取る・AI に返したコメントを待つ' },
  { name: 'token', summary: 'Jira のトークンを Mac のキーチェーンに入れる' },
  { name: 'update', summary: 'この clone と kotlin-lsp を最新（または指定のバージョン）にしてビルドし直す' },
  { name: 'completion', summary: 'Tab 補完のスクリプトを出力する' },
];

// zsh の単一引用符の中に入れるための書き方。' は '\'' と書く
export function zshQuote(text: string): string {
  return text.replace(/'/g, `'\\''`);
}

// 出すのは zsh の関数。TypeScript 側の変数は ${subcommands} で入れ、zsh 側の変数は $words のように書く。
// 末尾は、fpath から読まれたとき（$funcstack[1] が _ondina）は呼び、source されたときは compdef で登録する。
export function zshCompletion(): string {
  const subcommands = SUBCOMMANDS.map((c) => `    '${zshQuote(c.name)}:${zshQuote(c.summary)}'`).join('\n');
  return String.raw`#compdef ondina
# ondina の Tab 補完。ondina completion zsh が出力し、install.sh が ~/.zsh_functions/_ondina に置く

_ondina() {
  local state
  local -a subcommands
  subcommands=(
${subcommands}
    '--version:インストールされているバージョンを表示する'
    '--help:使い方を表示する'
  )

  _arguments -C \
    '1: :->command' \
    '*:: :->args' && return 0

  case $state in
    command)
      _describe -t commands 'ondina command' subcommands
      ;;
    args)
      case $words[1] in
        analyze)
          _arguments \
            '--base[比較の基点（ローカルモード）]:ref:' \
            '--head[比較する先（ローカルモード）]:ref:' \
            '--worktree-root[言語サーバー用の base と head の worktree を置く親]:directory:_files -/' \
            '--body[作者の説明（ローカルモード）]:file:_files' \
            '--title[題（ローカルモード）]:title:' \
            '--no-llm[LLM で目的ごとに分けない]' \
            '--relabel[保存した LLM 出力を使わず呼び直す]' \
            '--no-lsp[言語サーバーを起動しない]' \
            '--ticket[チケットの番号・URL・ファイル]:ticket:_files' \
            '1:PR 番号:'
          ;;
        serve)
          if [[ $words[2] == (stop|restart) ]]; then
            _arguments \
              '--all[動いている serve を全部]' \
              '*:ポート:'
          else
            local -a serve_subcommands
            serve_subcommands=(
              'list:動いている serve を一覧表示する'
              'stop:serve を止める'
              'restart:serve を今のバージョンで起動し直す'
            )
            _arguments \
              '--port[ポート番号]:port:' \
              '--background[バックグラウンドで起動し、URL を表示して戻る]' \
              '1:操作か PR 番号:{_describe -t serve-commands "操作（PR 番号も指定できる）" serve_subcommands}'
          fi
          ;;
        structure)
          _arguments '1:ref:'
          ;;
        comments)
          _arguments \
            '1:subcommand:(add wait)' \
            '--from[コメント JSON のファイル]:file:_files'
          ;;
        completion)
          _arguments '1:shell:(zsh)'
          ;;
      esac
      ;;
  esac
}

if [[ $funcstack[1] == _ondina ]]; then
  _ondina "$@"
else
  compdef _ondina ondina
fi
`;
}
