// この PR で消える宣言（説明タブの背景の「この PR の前からあるものは？」の候補。設計書 3.1。2026-10-29）。決定的（原則 7）。
// base と head の Kotlin を tree-sitter で読み、base にだけある宣言を fqName で拾う。親も消えるなら親だけ（クラスごと消えたらメンバーは並べない）。
// 主コンストラクタの val / var の引数もプロパティとして見る（class Order(val promo: Promo?) の promo）。名前の無い init と Kotlin 以外のファイルは見ない
import { collectDeclarations, type Declaration, type DeclarationKind } from './declarations.js';
import { langOf, type ChangedFile } from './extract.js';
import { parseKotlin } from './kotlin-parser.js';

export interface RemovedDeclaration {
  fqName: string;
  path: string;
  kind: DeclarationKind;
  /** base の行（1 始まり） */
  line: number;
}

interface Named {
  fqName: string;
  kind: DeclarationKind;
  line: number;
  parent?: string;
}

export async function removedDeclarations(files: readonly ChangedFile[]): Promise<RemovedDeclaration[]> {
  const out: RemovedDeclaration[] = [];
  for (const f of files) {
    if (f.before === null || langOf(f.path) !== 'kotlin') continue;
    const head = new Set((await namedIn(f.after ?? '')).map((d) => d.fqName));
    const gone = new Set<string>();
    for (const d of await namedIn(f.before)) {
      if (head.has(d.fqName)) continue;
      gone.add(d.fqName);
      if (d.kind === 'init' || (d.parent !== undefined && gone.has(d.parent))) continue;
      out.push({ fqName: d.fqName, path: f.path, kind: d.kind, line: d.line });
    }
  }
  return out;
}

/** 宣言を外側から順に（主コンストラクタのプロパティはクラスの本体のメンバーより前） */
async function namedIn(source: string): Promise<Named[]> {
  const walk = (d: Declaration): Named[] => [
    { fqName: d.fqName, kind: d.kind, line: d.startLine, ...(d.parentFqName === undefined ? {} : { parent: d.parentFqName }) },
    ...(d.ctorProperties ?? []).map((p): Named => ({ fqName: `${d.fqName}.${p.name}`, kind: 'property', line: p.line, parent: d.fqName })),
    ...d.children.flatMap(walk),
  ];
  return collectDeclarations(await parseKotlin(source)).declarations.flatMap(walk);
}
