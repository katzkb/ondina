// GitHub の Viewed（ファイル単位の閲覧の印）を GraphQL で読み書きする。設計書 12.1。
import { describe, expect, it } from 'vitest';
import { HeadMismatchError, parseViewedPage, readViewed, setViewed, viewedMutation } from '../src/github-viewed.js';

const head = 'a'.repeat(40);
const page = (nodes: Array<[string, string]>, next: string | null, headRefOid = head) =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          id: 'PR_kw42',
          headRefOid,
          files: { nodes: nodes.map(([path, viewerViewedState]) => ({ path, viewerViewedState })), pageInfo: { hasNextPage: next !== null, endCursor: next } },
        },
      },
    },
  });

type Call = { args: string[]; cwd: string };
const recorder = (outs: string[]) => {
  const calls: Call[] = [];
  const run = async (args: string[], cwd: string) => {
    calls.push({ args, cwd });
    const out = outs.shift();
    if (out === undefined) throw new Error('呼ばれすぎ');
    return out;
  };
  return { calls, run };
};
const field = (args: string[], name: string) => {
  const i = args.findIndex((a, j) => (args[j - 1] === '-f' || args[j - 1] === '-F') && a.startsWith(`${name}=`));
  return i < 0 ? undefined : args[i]!.slice(name.length + 1);
};

describe('parseViewedPage', () => {
  it('VIEWED のファイルだけを Viewed とし、DISMISSED（見た後に変更あり）は入れない', () => {
    const p = parseViewedPage(
      page(
        [
          ['src/A.kt', 'VIEWED'],
          ['src/B.kt', 'UNVIEWED'],
          ['src/C.kt', 'DISMISSED'],
        ],
        null,
      ),
    );
    expect(p).toEqual({ prId: 'PR_kw42', headSha: head, viewed: ['src/A.kt'], next: null });
  });

  it('次のページがあればカーソルを返す', () => {
    expect(parseViewedPage(page([], 'Y3Vyc29y')).next).toBe('Y3Vyc29y');
  });

  it('GraphQL のエラーはその文で失敗にする', () => {
    expect(() => parseViewedPage(JSON.stringify({ errors: [{ message: 'Could not resolve to a PullRequest with the number of 42.' }] }))).toThrow(/Could not resolve/);
  });

  it('PR が無い・形が違えば失敗にする', () => {
    expect(() => parseViewedPage(JSON.stringify({ data: { repository: { pullRequest: null } } }))).toThrow(/PR/);
  });
});

describe('viewedMutation', () => {
  it('付ける・外すを別名を付けて 1 つの mutation に並べる', () => {
    const q = viewedMutation({ mark: ['src/A.kt', 'src/B.kt'], unmark: ['src/C.kt'] });
    expect(q).toBe(
      'mutation($id: ID!) { ' +
        'm0: markFileAsViewed(input: {pullRequestId: $id, path: "src/A.kt"}) { clientMutationId } ' +
        'm1: markFileAsViewed(input: {pullRequestId: $id, path: "src/B.kt"}) { clientMutationId } ' +
        'u0: unmarkFileAsViewed(input: {pullRequestId: $id, path: "src/C.kt"}) { clientMutationId } }',
    );
  });

  it('パスの引用符とバックスラッシュはエスケープする', () => {
    expect(viewedMutation({ mark: ['a"b\\c.kt'], unmark: [] })).toContain('path: "a\\"b\\\\c.kt"');
  });
});

const target = JSON.stringify({ url: 'https://ghe.example.co.jp/team-a/order-service/pull/42' });

describe('readViewed', () => {
  it('先に gh pr view で PR のホストを取り、gh api graphql をそのホストに向ける（gh api はホストをリポジトリから決めない）', async () => {
    const { calls, run } = recorder([target, page([['src/A.kt', 'VIEWED']], null)]);
    expect(await readViewed('/repo', 42, run)).toEqual({ prId: 'PR_kw42', headSha: head, viewed: ['src/A.kt'] });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.cwd)).toEqual(['/repo', '/repo']);
    expect(calls[0]!.args).toEqual(['pr', 'view', '42', '--json', 'url']);
    expect(calls[1]!.args.slice(0, 4)).toEqual(['api', 'graphql', '--hostname', 'ghe.example.co.jp']);
    expect(field(calls[1]!.args, 'owner')).toBe('team-a');
    expect(field(calls[1]!.args, 'name')).toBe('order-service');
    expect(field(calls[1]!.args, 'number')).toBe('42');
    expect(field(calls[1]!.args, 'query')).toContain('viewerViewedState');
    expect(field(calls[1]!.args, 'after')).toBeUndefined();
  });

  it('100 件を超えるファイルはカーソルで次のページを読み、全部を合わせる', async () => {
    const { calls, run } = recorder([target, page([['src/A.kt', 'VIEWED']], 'c1'), page([['src/B.kt', 'VIEWED']], null)]);
    expect((await readViewed('/repo', 42, run)).viewed).toEqual(['src/A.kt', 'src/B.kt']);
    expect(calls).toHaveLength(3);
    expect(field(calls[2]!.args, 'after')).toBe('c1');
  });

  it('gh api の失敗は、理由に宛先を足して失敗にする（コピー&ペーストできない環境では貼れないので、画面の文で宛先が分かるように）', async () => {
    const run = async (args: string[]) => {
      if (args[0] === 'pr') return target;
      throw new Error("gh api graphql に失敗しました: GraphQL: Could not resolve to a Repository with the name 'team-a/order-service'. (repository)");
    };
    await expect(readViewed('/repo', 42, run)).rejects.toThrow(/Could not resolve.*（宛先: ghe\.example\.co\.jp\/team-a\/order-service）/);
  });

  it('gh pr view の失敗はそのまま失敗にする', async () => {
    const run = async () => {
      throw new Error('gh pr view に失敗しました: HTTP 401: Bad credentials');
    };
    await expect(readViewed('/repo', 42, run)).rejects.toThrow(/401/);
  });
});

describe('setViewed', () => {
  it('PR の id と head を読み、head が解析と同じなら付ける・外すを 1 回で送る（どちらも PR のホストへ）', async () => {
    const { calls, run } = recorder([target, page([], null), '{"data":{}}']);
    await setViewed('/repo', 42, head, { mark: ['src/A.kt'], unmark: ['src/B.kt'] }, run);
    expect(calls).toHaveLength(3);
    expect(calls[2]!.cwd).toBe('/repo');
    expect(calls[2]!.args.slice(0, 4)).toEqual(['api', 'graphql', '--hostname', 'ghe.example.co.jp']);
    expect(field(calls[2]!.args, 'id')).toBe('PR_kw42');
    expect(field(calls[2]!.args, 'query')).toBe(viewedMutation({ mark: ['src/A.kt'], unmark: ['src/B.kt'] }));
  });

  it('PR の head が解析と違えば送らず HeadMismatchError', async () => {
    const { calls, run } = recorder([target, page([], null, 'b'.repeat(40))]);
    await expect(setViewed('/repo', 42, head, { mark: ['src/A.kt'], unmark: [] }, run)).rejects.toBeInstanceOf(HeadMismatchError);
    expect(calls).toHaveLength(2);
  });

  it('付ける・外すが空なら gh を呼ばない', async () => {
    const { calls, run } = recorder([]);
    await setViewed('/repo', 42, head, { mark: [], unmark: [] }, run);
    expect(calls).toHaveLength(0);
  });

  it('mutation の GraphQL エラーは失敗にする', async () => {
    const { run } = recorder([target, page([], null), JSON.stringify({ errors: [{ message: "Field 'markFileAsViewed' doesn't exist on type 'Mutation'" }] })]);
    await expect(setViewed('/repo', 42, head, { mark: ['src/A.kt'], unmark: [] }, run)).rejects.toThrow(/markFileAsViewed/);
  });
});
