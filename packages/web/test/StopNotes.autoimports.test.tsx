// 停留所の右の列の「次は X」が、import だけの差分を飛ばすときは飛ばした先の停留所を出す（2026-11-07）。
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StopNotes } from '../src/components/CourseChecks.js';
import { courseOf, courses, stopAfter, stopInfo } from '../src/course.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const analysis = fixtureAnalysis();
const c6 = courseOf(courses(analysis), 6)!;
const infos = c6.steps.map((_, i) => stopInfo(analysis, c6, i, emptyReview()));

function nextLine(skip: boolean): string {
  render(<StopNotes analysis={analysis} course={c6} infos={infos} k={3} nextK={stopAfter(analysis, c6, 3, skip)} dispatch={() => {}} />);
  return screen.getByText(/^次は/).closest('div')!.textContent ?? '';
}

describe('StopNotes: 次は', () => {
  afterEach(cleanup);

  it('飛ばさないときは次の停留所（import だけの差分）', () => {
    expect(nextLine(false)).toContain('ApplyDiscountRequest.kt');
  });

  it('飛ばすときは import だけの差分を越えた停留所', () => {
    expect(nextLine(true)).toBe('次はApplyDiscountRequest');
  });
});
