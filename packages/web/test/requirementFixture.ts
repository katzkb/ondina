import type { Analysis, Chapter, HunkIntent, Spec } from '@ondina/model';
import chapters from '../../../fixtures/order-service/expected/chapters.json';
import intents from '../../../fixtures/order-service/expected/intents.json';
import specs from '../../../fixtures/order-service/expected/specs.json';
import { fixtureAnalysis } from './fixture.js';

export function requirementAnalysis(): Analysis {
  return { ...fixtureAnalysis(), chapters: structuredClone(chapters) as Chapter[], intents: structuredClone(intents) as HunkIntent[], specs: structuredClone(specs.specs) as Spec[] };
}

/** 開始・終了ページ用。実際の差分から 3 ファイル（2 / 2 / 1 hunks）を使う。 */
export function requirementBookends(): Analysis {
  const a = requirementAnalysis();
  a.hunks = a.hunks.filter((h) => /\/(Logger|InvoiceBuilder|FeatureFlags)\.kt$/.test(h.path)).reverse();
  a.githubDiff = a.githubDiff!.filter((f) => a.hunks.some((h) => h.path === f.path));
  const ids = (name: string) => a.hunks.filter((h) => h.path.endsWith(`/${name}.kt`)).map((h) => h.id);
  a.chapters = [
    { kind: 'spec', specId: 's1', hunkIds: ids('Logger') },
    { kind: 'spec', specId: 's2', hunkIds: ids('FeatureFlags') },
    { kind: 'spec', specId: 's3', hunkIds: [] },
    { kind: 'follow', hunkIds: ids('InvoiceBuilder') },
    { kind: 'extra', hunkIds: [] },
  ];
  a.summary = { headline: '割引の持ち方を変える。', example: { text: '割引を適用すると\n金額が変わる。', at: [] } };
  a.pr.ticket = { ref: 'SHOP-421', key: 'SHOP-421', source: 'jira', at: '2026-11-09T00:00:00Z' };
  a.background = { why: ['割引を注文ごとに記録するため。'], project: { parent: { key: 'SHOP-400', url: 'https://example.test/SHOP-400', via: 'parent', title: '注文の割引' }, why: ['注文の割引を扱う。'] } };
  return a;
}
