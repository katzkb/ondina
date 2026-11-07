// 設定の「import だけの差分を自動でチェック済みにする」（autoCheckImports。2026-11-07）。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '../src/components/SettingsModal.js';

const theme = { mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' } as const;

function open(autoCheckImports?: boolean) {
  const dispatch = vi.fn();
  render(<SettingsModal tab="general" theme={theme} worktreeRoot="" llmCommand="" reviewCommand="" ticket={{}} {...(autoCheckImports === undefined ? {} : { autoCheckImports })} dispatch={dispatch} />);
  const row = screen.getByRole('group', { name: 'import だけの差分を自動でチェック済みにする' });
  return { dispatch, row };
}

describe('SettingsModal: import だけの差分', () => {
  afterEach(cleanup);

  it('説明つきの 1 行があり、既定はオフ', () => {
    const { row } = open();
    expect(screen.getByText('ファイルの先頭の差分のうち、package と import の行だけが変わったものです。コースではそこに止まりません。')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'オフ' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(row).getByRole('button', { name: 'オン' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('オンにするとコマンドで設定を変える', () => {
    const { dispatch, row } = open(false);
    fireEvent.click(within(row).getByRole('button', { name: 'オン' }));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'ui.autoCheckImports', value: true });
  });

  it('オンのときはオンが押されていて、オフを押すとオフにする', () => {
    const { dispatch, row } = open(true);
    expect(within(row).getByRole('button', { name: 'オン' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(row).getByRole('button', { name: 'オフ' }));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'ui.autoCheckImports', value: false });
  });
});
