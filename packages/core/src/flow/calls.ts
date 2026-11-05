// 流れの呼び出しに、呼び出しの式（BehaviorCall）を付ける（設計書 3.3。2026-11-05）。決定的（原則 7）。
// 選び方は動き（behavior/calls.ts）と同じ。変わる前の呼び出しは base のファイル、変わった後の呼び出しは head のファイルを読む
import { createCallReader } from '../behavior/calls.js';
import type { CallFlow, FlowCall, FlowCallSite, Symbol as OndinaSymbol } from '../model.js';

export interface AttachFlowCallsArgs {
  symbols: readonly Pick<OndinaSymbol, 'id' | 'fqName' | 'path'>[];
  /** repo 相対のパスで head の全文を返す。読めなければ undefined */
  readHead: (path: string) => string | undefined;
  /** repo 相対のパスで base の全文を返す。読めなければ undefined */
  readBase: (path: string) => string | undefined;
}

export async function attachFlowCalls(flows: readonly CallFlow[], { symbols, readHead, readBase }: AttachFlowCallsArgs): Promise<CallFlow[]> {
  const byId = new Map(symbols.map((s) => [s.id, s]));
  const head = createCallReader(readHead);
  const base = createCallReader(readBase);
  const withCall = async (s: FlowCallSite | undefined, from: string | null, to: string, read: typeof head): Promise<FlowCallSite | undefined> => {
    const caller = from === null ? undefined : byId.get(from);
    const callee = byId.get(to);
    if (s === undefined || s.line === undefined || caller === undefined || callee === undefined) return s;
    const call = await read(caller.path, s.line, callee.fqName);
    return call === undefined ? s : { line: s.line, call, ...(s.returns === undefined ? {} : { returns: s.returns }) };
  };
  const walk = async (c: FlowCall): Promise<FlowCall> => {
    const before = await withCall(c.before, c.from, c.to, base);
    const after = await withCall(c.after, c.from, c.to, head);
    const kids: FlowCall[] = [];
    for (const k of c.kids) kids.push(await walk(k));
    return { ...c, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }), kids };
  };
  const out: CallFlow[] = [];
  for (const f of flows) out.push({ ...f, root: await walk(f.root) });
  return out;
}
