// 保存したプロジェクト構造（kotlin-lsp の exportWorkspace が書く workspace.json。設計書 9.1）。
// 2026-10-19 の実測: Gradle のファイルが無いフォルダに置くと、Gradle を走らせずに JSON で取り込み、結果は Gradle の形と完全に一致した。
// ただし構造には書き出した時点に在るソースのフォルダしか入らない（src/main/java が無ければ入らない）。
import { describe, expect, it } from 'vitest';
import { outsideSourceDirs, placeProjectModel, projectModelFiles, projectModelKey, projectModelSourceDirs } from '../src/lsp/project-model.js';

/** fixture を kotlin-lsp 263.6379.0 で書き出した workspace.json を縮めたもの（形は本物のまま） */
const MODEL = {
  modules: [
    { name: 'order-service', dependencies: [{ type: 'moduleSource' }, { type: 'sdk', name: '25', kind: 'jdk' }], contentRoots: [{ path: '<WORKSPACE>/' }], externalProjectPath: '<WORKSPACE>/', externalProjectId: ':' },
    {
      name: 'order-service.main',
      contentRoots: [
        {
          path: '<WORKSPACE>/src/main',
          sourceRoots: [
            { path: '<WORKSPACE>/src/main/kotlin', type: 'java-source' },
            { path: '<WORKSPACE>/src/main/resources', type: 'java-resource' },
          ],
        },
      ],
      externalProjectPath: '<WORKSPACE>/',
    },
    { name: 'order-service.test', contentRoots: [{ path: '<WORKSPACE>/src/test', sourceRoots: [{ path: '<WORKSPACE>/src/test/kotlin', type: 'java-test' }] }] },
  ],
  libraries: [
    {
      name: 'Gradle: io.micrometer:micrometer-commons:1.14.0',
      type: 'COMPILE',
      roots: [
        { path: '<HOME>/.gradle/caches/modules-2/files-2.1/io.micrometer/micrometer-commons-1.14.0.jar' },
        { path: '<HOME>/.gradle/caches/modules-2/files-2.1/io.micrometer/micrometer-commons-1.14.0-sources.jar', type: 'SOURCES' },
      ],
    },
    { name: 'Maven: x', roots: [{ path: '<MAVEN_REPO>/x/x.jar' }] },
  ],
  sdks: [{ name: '25', type: 'jdk', homePath: '<HOME>/.local/share/kotlin-lsp/kotlin-server-263.6379.0/jbr/Contents/Home' }, { name: '21', type: 'jdk', homePath: '/Library/Java/jdk-21/Contents/Home' }],
  kotlinSettings: [{ name: 'Kotlin', sourceRoots: ['<WORKSPACE>/src/main/kotlin', '<WORKSPACE>/src/main/resources'], module: 'order-service.main' }],
  javaSettings: [{ module: 'order-service.main', compilerOutput: '<WORKSPACE>/build/classes/java/main' }],
  externalSystem: 'GRADLE',
};

describe('projectModelKey', () => {
  const files = [
    { path: 'build.gradle.kts', blob: 'a'.repeat(40) },
    { path: 'settings.gradle.kts', blob: 'b'.repeat(40) },
  ];

  it('並びに依らない', () => {
    expect(projectModelKey('/k/intellij-server', files)).toBe(projectModelKey('/k/intellij-server', [...files].reverse()));
  });

  it('ファイルの中身（blob）が変わると変わる', () => {
    expect(projectModelKey('/k/intellij-server', files)).not.toBe(projectModelKey('/k/intellij-server', [files[0]!, { path: 'settings.gradle.kts', blob: 'c'.repeat(40) }]));
  });

  it('言語サーバーの実体が変わると変わる（バージョンの入れ替えで JDK の場所も変わる）', () => {
    expect(projectModelKey('/k/kotlin-server-263.6379.0/bin/intellij-server', files)).not.toBe(projectModelKey('/k/kotlin-server-263.7084.0/bin/intellij-server', files));
  });

  it('ファイル名に使える 16 進', () => {
    expect(projectModelKey('/k', files)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('placeProjectModel', () => {
  it('<WORKSPACE> をその worktree の絶対パスにする。ほかの置き換え（<HOME> など）は kotlin-lsp が解くのでそのまま', () => {
    const placed = JSON.parse(placeProjectModel(MODEL, '/r/.ondina/lsp/head')) as typeof MODEL;
    expect(placed.modules[0]!.contentRoots[0]!.path).toBe('/r/.ondina/lsp/head/');
    expect(placed.modules[1]!.contentRoots[0]!.sourceRoots![0]!.path).toBe('/r/.ondina/lsp/head/src/main/kotlin');
    expect(placed.libraries[0]!.roots[0]!.path).toMatch(/^<HOME>\//);
  });

  it('パスに " や $& があっても JSON が壊れない', () => {
    const placed = JSON.parse(placeProjectModel(MODEL, '/r/a"b$&c')) as typeof MODEL;
    expect(placed.modules[0]!.externalProjectPath).toBe('/r/a"b$&c/');
  });
});

describe('projectModelFiles', () => {
  it('ライブラリと JDK のパス（<HOME> を解いた絶対パス）。worktree の中と <MAVEN_REPO> は見ない', () => {
    expect(projectModelFiles(MODEL, '/Users/u')).toEqual([
      '/Users/u/.gradle/caches/modules-2/files-2.1/io.micrometer/micrometer-commons-1.14.0.jar',
      '/Users/u/.gradle/caches/modules-2/files-2.1/io.micrometer/micrometer-commons-1.14.0-sources.jar',
      '/Users/u/.local/share/kotlin-lsp/kotlin-server-263.6379.0/jbr/Contents/Home',
      '/Library/Java/jdk-21/Contents/Home',
    ]);
  });
});

describe('projectModelSourceDirs', () => {
  it('モジュールのソースのフォルダ（リポジトリ相対、重ねない）', () => {
    expect(projectModelSourceDirs(MODEL)).toEqual(['src/main/kotlin', 'src/main/resources', 'src/test/kotlin']);
  });

  it('最上位がソースのフォルダなら空文字', () => {
    expect(projectModelSourceDirs({ modules: [{ contentRoots: [{ path: '<WORKSPACE>/', sourceRoots: [{ path: '<WORKSPACE>/' }] }] }] })).toEqual(['']);
  });
});

describe('outsideSourceDirs', () => {
  const dirs = ['src/main/kotlin', 'src/test/kotlin'];

  it('どのソースのフォルダの下にもない変更ファイル', () => {
    expect(outsideSourceDirs(dirs, ['src/main/kotlin/a/A.kt', 'src/main/java/a/B.kt', 'src/test/kotlin/ATest.kt', 'docs/S.kt'])).toEqual(['src/main/java/a/B.kt', 'docs/S.kt']);
  });

  it('名前の頭が同じだけのフォルダは下ではない', () => {
    expect(outsideSourceDirs(dirs, ['src/main/kotlinx/A.kt'])).toEqual(['src/main/kotlinx/A.kt']);
  });

  it('最上位がソースのフォルダなら全部が下', () => {
    expect(outsideSourceDirs([''], ['A.kt', 'x/B.kt'])).toEqual([]);
  });
});
