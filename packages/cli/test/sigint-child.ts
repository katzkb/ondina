// llm.test.ts の Ctrl-C の確認用。runLlmCommand の途中で SIGINT を受けたとき、プロセスごと終わる（結果を print しない）ことを見る
import { runLlmCommand } from '../src/llm.js';

const r = await runLlmCommand('sleep 30; echo late', 'x', process.cwd());
process.stdout.write(`survived: ${JSON.stringify(r)}\n`);
