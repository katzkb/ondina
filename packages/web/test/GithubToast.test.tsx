// GitHub の Viewed の通知（設計書 12.1）: 右下に 6 秒。マウスが乗っている間は消さない。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { GithubToast } from '../src/components/GithubToast.js';

describe('GithubToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  const toast = { n: 3, message: 'OrderAdminView.kt を GitHub で Viewed にできませんでした', reason: 'HTTP 401', retry: { kind: 'set' as const, mark: ['a'], unmark: [] }, tone: 'error' as const };

  it('6 秒で閉じる（出した通知の番号で）', () => {
    const got: Command[] = [];
    render(<GithubToast toast={toast} dispatch={(c) => got.push(c)} />);
    act(() => vi.advanceTimersByTime(5999));
    expect(got).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(got).toEqual([{ id: 'github.toast.close', n: 3 }]);
  });

  it('マウスが乗っている間は閉じず、離れてから 6 秒で閉じる', () => {
    const got: Command[] = [];
    render(<GithubToast toast={toast} dispatch={(c) => got.push(c)} />);
    fireEvent.mouseEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(20000));
    expect(got).toEqual([]);
    fireEvent.mouseLeave(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(6000));
    expect(got).toEqual([{ id: 'github.toast.close', n: 3 }]);
  });

  it('再試行は github.retry。再試行の無い通知にはボタンが無い', () => {
    const got: Command[] = [];
    const { rerender } = render(<GithubToast toast={toast} dispatch={(c) => got.push(c)} />);
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(got).toEqual([{ id: 'github.retry' }]);
    rerender(<GithubToast toast={{ ...toast, n: 4, retry: null }} dispatch={(c) => got.push(c)} />);
    expect(screen.queryByRole('button', { name: '再試行' })).toBeNull();
  });

  it('通知が無ければ何も描かない', () => {
    const { container } = render(<GithubToast toast={null} dispatch={() => undefined} />);
    expect(container.innerHTML).toBe('');
  });
});
