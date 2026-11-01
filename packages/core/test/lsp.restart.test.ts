// 起動したままの言語サーバーが読み直さないファイル（設計書 9.1）。
// kotlin-lsp は起動したまま中身を切り替えても Gradle の取り込みをやり直さない（2026-10-15 実測）。
// 依存を足した PR で、足した gson の 5 か所に色が付かなかった。起動し直すと正しくなる。
import { describe, expect, it } from 'vitest';
import { buildConfigPaths, firstRestartPath } from '../src/lsp/restart.js';

describe('firstRestartPath', () => {
  it('Gradle の設定ファイルを拾う', () => {
    for (const p of ['build.gradle.kts', 'app/build.gradle', 'settings.gradle.kts', 'gradle.properties', 'sub/gradle.properties', 'gradle/libs.versions.toml', 'gradle/wrapper/gradle-wrapper.properties', 'buildSrc/src/main/kotlin/Conventions.kt', 'tools/deps.versions.toml']) {
      expect(firstRestartPath('kotlin', [p]), p).toBe(p);
    }
  });

  it('ソースや、名前に gradle を含むだけのファイルは拾わない', () => {
    expect(firstRestartPath('kotlin', ['src/main/kotlin/A.kt', 'docs/gradle.md', 'src/gradle/Plugin.kt', 'README.md'])).toBeUndefined();
  });

  it('最初に当たったパスを返す', () => {
    expect(firstRestartPath('kotlin', ['src/main/kotlin/A.kt', 'app/build.gradle.kts', 'gradle.properties'])).toBe('app/build.gradle.kts');
  });

  it('規則の無い言語では起動し直さない', () => {
    expect(firstRestartPath('typescript', ['build.gradle.kts'])).toBeUndefined();
  });
});

// 保存したプロジェクト構造の key（設計書 9.1）。起動し直す規則と同じファイルを使う
describe('buildConfigPaths', () => {
  it('ビルドの設定ファイルだけを、元の並びのまま返す', () => {
    expect(buildConfigPaths('kotlin', ['src/main/kotlin/A.kt', 'settings.gradle.kts', 'app/build.gradle.kts', 'README.md', 'gradle/libs.versions.toml'])).toEqual(['settings.gradle.kts', 'app/build.gradle.kts', 'gradle/libs.versions.toml']);
  });

  it('規則の無い言語では undefined（Gradle の形かどうかを決められない）', () => {
    expect(buildConfigPaths('typescript', ['build.gradle.kts'])).toBeUndefined();
  });
});
