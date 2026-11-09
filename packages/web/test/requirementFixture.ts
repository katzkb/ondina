import type { Analysis, Chapter, HunkIntent, Spec } from '@ondina/model';
import chapters from '../../../fixtures/order-service/expected/chapters.json';
import intents from '../../../fixtures/order-service/expected/intents.json';
import specs from '../../../fixtures/order-service/expected/specs.json';
import { fixtureAnalysis } from './fixture.js';

export function requirementAnalysis(): Analysis {
  return { ...fixtureAnalysis(), chapters: structuredClone(chapters) as Chapter[], intents: structuredClone(intents) as HunkIntent[], specs: structuredClone(specs.specs) as Spec[] };
}
