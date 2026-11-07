// 意味的 hunk の切り出し。設計書 5.2 手順1。
//
// 変更ファイルを before / after ともに tree-sitter-kotlin でパースし、差分が触れている最小の宣言ノードを 1 hunk にする。
// 1 宣言に複数の変更範囲があれば 1 hunk にまとめる。
//
// 規則（2026-09-15 に確認して決めたもの。設計書 5.2 に反映）:
// - 変更ブロックの i 行目どうし（旧側と新側）を対にし、対の宣言が異なれば共通の親宣言に格上げする
//   （class Order の中で getDiscount を消して applyDiscount を足した場合は class Order 全体が 1 hunk）
// - 共通の親宣言が無い（トップレベルどうし）ならファイル hunk に格上げする
// - 入れ子になった hunk は外側の hunk に統合する
// - 宣言の外側（package / import / トップレベルコメント）の変更は 1 ファイルにつき 1 つのファイル hunk にまとめる
// - 空白だけの行の変更は hunk を作らない
// - Kotlin 以外のファイルはファイル単位で 1 hunk
// - ファイル hunk は、変わった行が package・import・空行だけなら importsOnly を立てる（構文木で決める。コメントや @file: は含めない）
import path from 'node:path';
import { changedLines } from './changed-lines.js';
import { ancestorChain, collectDeclarations, declarationAt, type DeclarationKind, type DeclarationTree } from './declarations.js';
import { headerLines } from './header-lines.js';
import { parseKotlin } from './kotlin-parser.js';
import { changeBlocks, splitLines, unifiedLines, type ChangeBlock } from './line-diff.js';
import { hunkId } from './stable-id.js';

export interface ChangedFile {
  /** repo 相対 */
  path: string;
  /** base 側の内容。追加ファイルなら null */
  before: string | null;
  /** head 側の内容。削除ファイルなら null */
  after: string | null;
}

/** Stage 1 が hunk について確定できる事実。kind / hows などは後段（8章・10章）が埋める */
export interface SemanticHunk {
  id: string;
  path: string;
  lang: string;
  /** 表示用。"applyDiscount()" / "OrderResponse" / "Order.kt" */
  symbol: string;
  /** 宣言の fqName。ファイル hunk なら path */
  symbolFqName: string;
  symbolKind: DeclarationKind | 'file';
  /** 旧側の開始行。旧側に行が無ければ挿入位置 */
  lnOld: number;
  /** 新側の開始行。新側に行が無ければ挿入位置 */
  lnNew: number;
  /** 1文字目が ' ' | '+' | '-' の統合形式 */
  lines: string[];
  /** Kotlin のファイル hunk で、変わった行が package・import・空行だけのとき true。立たないときは欄なし */
  importsOnly?: true;
}

export async function extractHunks(file: ChangedFile): Promise<SemanticHunk[]> {
  if (file.before === file.after) return [];
  const lang = langOf(file.path);
  if (lang !== 'kotlin') return [wholeFileHunk(file, lang)];
  return extractKotlinHunks(file);
}

export async function extractAllHunks(files: ChangedFile[]): Promise<SemanticHunk[]> {
  const result: SemanticHunk[] = [];
  for (const file of files) result.push(...(await extractHunks(file)));
  return result;
}

export function langOf(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext === 'kt' || ext === 'kts') return 'kotlin';
  return ext === '' ? 'text' : ext;
}

function wholeFileHunk(file: ChangedFile, lang: string): SemanticHunk {
  return fileHunk(file.path, lang, 1, 1, unifiedLines(splitLines(file.before ?? ''), splitLines(file.after ?? '')));
}

function fileHunk(filePath: string, lang: string, lnOld: number, lnNew: number, lines: string[]): SemanticHunk {
  return {
    id: hunkId(filePath, filePath),
    path: filePath,
    lang,
    symbol: path.basename(filePath),
    symbolFqName: filePath,
    symbolKind: 'file',
    lnOld,
    lnNew,
    lines,
  };
}

type Side = 'old' | 'new';
const FILE_KEY = 'file';

interface Range {
  start: number;
  end: number;
}

async function extractKotlinHunks(file: ChangedFile): Promise<SemanticHunk[]> {
  const oldLines = splitLines(file.before ?? '');
  const newLines = splitLines(file.after ?? '');
  const blocks = changeBlocks(oldLines, newLines);
  if (blocks.length === 0) return [];

  const parsed = { old: await parseKotlin(file.before ?? ''), new: await parseKotlin(file.after ?? '') };
  const trees: Record<Side, DeclarationTree> = { old: collectDeclarations(parsed.old), new: collectDeclarations(parsed.new) };
  const lines: Record<Side, string[]> = { old: oldLines, new: newLines };
  const outsideLines: Record<Side, number[]> = { old: [], new: [] };

  // 1. 各変更行に「最も内側の宣言」か「宣言の外」を割り当て、旧側と新側を行の対で結ぶ
  const uf = new UnionFind();
  const keyFor = (side: Side, line: number): string | undefined => {
    if (lines[side][line - 1]?.trim() === '') return undefined;
    const decl = declarationAt(trees[side], line);
    if (decl === undefined) {
      outsideLines[side].push(line);
      return FILE_KEY;
    }
    return `${side}:${decl.fqName}`;
  };
  for (const block of blocks) {
    const oldKeys = rangeOf(block, 'old').map((l) => keyFor('old', l));
    const newKeys = rangeOf(block, 'new').map((l) => keyFor('new', l));
    for (const k of [...oldKeys, ...newKeys]) if (k !== undefined) uf.add(k);
    for (let i = 0; i < Math.min(oldKeys.length, newKeys.length); i++) {
      const a = oldKeys[i];
      const b = newKeys[i];
      // 宣言の外（import など）と宣言は結ばない。宣言がファイル hunk に巻き込まれるのを防ぐ
      if (a !== undefined && b !== undefined && (a === FILE_KEY) === (b === FILE_KEY)) uf.union(a, b);
    }
  }

  // 2. 連結成分ごとに hunk の単位（宣言 fqName かファイル）を決める
  const targets = new Set<string>();
  const fileMembers: Record<Side, string[]> = { old: [], new: [] };
  for (const keys of uf.groups()) {
    if (keys.includes(FILE_KEY)) continue;
    const members = keys.map(parseKey);
    const fqNames = new Set(members.map((m) => m.fqName));
    if (fqNames.size === 1) {
      targets.add(members[0]!.fqName);
      continue;
    }
    const chains = members.map((m) => ancestorChain(trees[m.side], m.fqName));
    const common = deepestCommon(chains);
    if (common !== undefined) {
      targets.add(common);
    } else {
      for (const m of members) fileMembers[m.side].push(m.fqName);
    }
  }

  // 3. 入れ子の hunk は外側に統合する
  const isNested = (fqName: string): boolean =>
    (['old', 'new'] as const).some((side) => ancestorChain(trees[side], fqName).slice(0, -1).some((a) => targets.has(a)));
  const finalTargets = [...targets].filter((t) => !isNested(t));

  // 4. hunk を組み立てる
  const hunks: SemanticHunk[] = [];
  for (const fqName of finalTargets) {
    const oldDecl = trees.old.byFqName.get(fqName);
    const newDecl = trees.new.byFqName.get(fqName);
    const oldRange = oldDecl === undefined ? undefined : { start: oldDecl.startLine, end: oldDecl.endLine };
    const newRange = newDecl === undefined ? undefined : { start: newDecl.startLine, end: newDecl.endLine };
    const decl = (newDecl ?? oldDecl)!;
    hunks.push({
      id: hunkId(file.path, fqName),
      path: file.path,
      lang: 'kotlin',
      symbol: displaySymbol(decl.kind, decl.name),
      symbolFqName: fqName,
      symbolKind: decl.kind,
      lnOld: oldRange?.start ?? insertionPoint(blocks, 'old', newRange!.start),
      lnNew: newRange?.start ?? insertionPoint(blocks, 'new', oldRange!.start),
      lines: unifiedLines(slice(oldLines, oldRange), slice(newLines, newRange)),
    });
  }

  const fileRange = (side: Side): Range | undefined => {
    const points = [
      ...outsideLines[side],
      ...fileMembers[side].flatMap((fq) => {
        const d = trees[side].byFqName.get(fq);
        return d === undefined ? [] : [d.startLine, d.endLine];
      }),
    ];
    return points.length === 0 ? undefined : { start: Math.min(...points), end: Math.max(...points) };
  };
  const oldFile = fileRange('old');
  const newFile = fileRange('new');
  if (oldFile !== undefined || newFile !== undefined) {
    const hunk = fileHunk(
      file.path,
      'kotlin',
      oldFile?.start ?? insertionPoint(blocks, 'old', newFile!.start),
      newFile?.start ?? insertionPoint(blocks, 'new', oldFile!.start),
      unifiedLines(slice(oldLines, oldFile), slice(newLines, newFile)),
    );
    const headers: Record<Side, Set<number>> = { old: headerLines(parsed.old), new: headerLines(parsed.new) };
    const changed = changedLines(hunk);
    const onlyHeaders = (side: Side, numbers: number[]): boolean => numbers.every((l) => headers[side].has(l) || lines[side][l - 1]?.trim() === '');
    if (onlyHeaders('old', changed.oldLines) && onlyHeaders('new', changed.newLines)) hunk.importsOnly = true;
    hunks.push(hunk);
  }

  return hunks.sort((a, b) => a.lnNew - b.lnNew || a.lnOld - b.lnOld || a.symbolFqName.localeCompare(b.symbolFqName));
}

function rangeOf(block: ChangeBlock, side: Side): number[] {
  const [start, end] = side === 'old' ? [block.oldStart, block.oldEnd] : [block.newStart, block.newEnd];
  const out: number[] = [];
  for (let l = start; l <= end; l++) out.push(l);
  return out;
}

function parseKey(key: string): { side: Side; fqName: string } {
  const sep = key.indexOf(':');
  return { side: key.slice(0, sep) as Side, fqName: key.slice(sep + 1) };
}

/** 全ての鎖に含まれる最も深い fqName */
function deepestCommon(chains: string[][]): string | undefined {
  const [first, ...rest] = chains;
  if (first === undefined) return undefined;
  for (let i = first.length - 1; i >= 0; i--) {
    const candidate = first[i]!;
    if (rest.every((c) => c.includes(candidate))) return candidate;
  }
  return undefined;
}

/** 片側に行が無い hunk の、その側での位置。反対側の行を含む変更ブロックの開始位置 */
function insertionPoint(blocks: ChangeBlock[], side: Side, otherSideLine: number): number {
  const block =
    blocks.find((b) => (side === 'old' ? b.newStart <= otherSideLine && otherSideLine <= b.newEnd : b.oldStart <= otherSideLine && otherSideLine <= b.oldEnd)) ?? blocks[0]!;
  return side === 'old' ? block.oldStart : block.newStart;
}

function slice(lines: string[], range: Range | undefined): string[] {
  return range === undefined ? [] : lines.slice(range.start - 1, range.end);
}

function displaySymbol(kind: DeclarationKind, name: string): string {
  switch (kind) {
    case 'function':
    case 'constructor':
      return `${name}()`;
    default:
      return name;
  }
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = key;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  /** 挿入順を保った連結成分 */
  groups(): string[][] {
    const byRoot = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      const list = byRoot.get(root);
      if (list === undefined) byRoot.set(root, [key]);
      else list.push(key);
    }
    return [...byRoot.values()];
  }
}
