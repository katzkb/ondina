// 入口の地図の動き（設計書 3.1。2026-11-04 の見本 5）。動きの並び・地図の上の矢印と札・シーケンス図・再生の帯。
// 矢印の文字は呼び出しだけ（name(…n)。押すと map.args で全部の札が呼び出しの式になる）。戻りは言語サーバーの戻り型（↩）。
// 差分の無い相手は呼ぶ側の「中で」に出す。シーケンス図の列の頭は、いまの図の item そのもの（箱は押すとそのコース、まとまり・札はそこへ入る）。
// 描くだけで、歩・場所・配置は behavior.ts が組む（原則 3・5）。押した物は全部コマンド（原則 6）
import type { Analysis, Behavior } from '@ondina/model';
import { Fragment, type CSSProperties } from 'react';
import type { Command } from '../commands/commands.js';
import { CALLER, inDeeper, labelAt, labelW, rowState, stepBoxes, type FlowDraw, type FlowStep, type SeqLayout, type SeqRow } from '../map/groupmap/behavior.js';
import { moveMs, whereTo } from '../map/groupmap/flow.js';
import { textW, type PlacedItem, type PlacedView } from '../map/groupmap/layout.js';
import { crumbName, pathTo, type MapFacts } from '../map/groupmap/view.js';
import { NO_LAYER } from '../map/graph.js';
import { Short, SpeedControl, stopKeys, Token } from './gmapParts.js';
import { Key } from './Key.js';

const textOf = (s: FlowStep, args: boolean) => (args ? s.full : s.short);
const argsTitle = (s: FlowStep, args: boolean) => (s.full === s.short ? undefined : args ? '押すと引数を畳む' : `押すと引数を出す: ${s.full}`);

/** 動きの並び（地図の上）。押すと選ぶ、もう一度で外す */
export function BehaviorPicker({ behaviors, sel, dispatch }: { behaviors: readonly Behavior[]; sel: string | null; dispatch: (c: Command) => void }) {
  return (
    <div className="gbehs" role="group" aria-label="動き">
      <span className="lbl">動き</span>
      {behaviors.map((b) => (
        <button key={b.id} type="button" aria-pressed={sel === b.id} onClick={() => dispatch({ id: 'home.behavior', behaviorId: b.id })} onKeyDown={stopKeys}>
          <i aria-hidden="true">▶</i>
          <span className={b.titleProvenance === 'llm' ? 'guess' : ''}>{b.title}</span>
          <small>{`${b.messages.length + 1} 歩`}</small>
        </button>
      ))}
    </div>
  );
}

/** 「中で」の札の大きさの見積もり（図を伸ばす分） */
export function inCardAt(view: PlacedView, item: PlacedItem, s: FlowStep, args: boolean): { left: number; top: number; h: number } {
  const lines = Math.ceil((textW(textOf(s, args)) + 30) / 300) + (s.returns !== undefined ? 1 : 0) + (s.to === null ? 1 : 0);
  return { left: Math.max(0, Math.min(item.x, view.w - 334)), top: item.y + item.h + 6, h: 26 + lines * 17 };
}

interface FlowLayerProps {
  view: PlacedView;
  facts: MapFacts;
  analysis: Analysis;
  draw: FlowDraw;
  args: boolean;
  /** 玉が動いている歩の鍵（動いていなければ null） */
  moving: string | null;
  speed: number;
  onArrive: (key: string) => void;
  dispatch: (c: Command) => void;
}

/** 地図の上の動き: 矢印（今の歩は太く、玉が呼ぶ側から動く）・呼び出し元の点・今の歩の札 */
export function FlowLayer({ view, facts, analysis, draw, args, moving, speed, onArrive, dispatch }: FlowLayerProps) {
  const byId = new Map(view.items.map((it) => [it.id, it]));
  const cur = draw.cur;
  const dots = [...new Map(draw.arrows.flatMap((a) => (a.dot ? [[a.dot.join(','), a.dot] as const] : []))).values()];
  let label = null;
  if (cur && moving === null) {
    const s = cur.step;
    const body = (
      <>
        <button type="button" className="gfl-c" title={argsTitle(s, args)} onClick={() => dispatch({ id: 'map.args' })} onKeyDown={stopKeys}>
          {textOf(s, args)}
        </button>
        {s.returns !== undefined && <span className="gfl-r">{`↩ ${s.returns}`}</span>}
      </>
    );
    if (cur.arrow) {
      const w = labelW(textOf(s, args));
      const p = labelAt(cur.arrow.pts, w, view.w);
      label = (
        <span className="gfl" style={{ left: p.x, top: p.y, maxWidth: w + 40 }}>
          {body}
        </span>
      );
    } else if (cur.place.t === 'in' && cur.place.at !== null) {
      const at = cur.place.at;
      const item = byId.get(at)!;
      const c = inCardAt(view, item, s, args);
      const deeper = inDeeper(facts.tree, view.spec, s, at);
      label = (
        <div className="gfin" style={{ left: c.left, top: c.top }}>
          <div className="gfin-h">
            <b>{deeper ? `↻ ${crumbName(analysis, facts.tree, deeper)} の中で` : '↻ 中で'}</b>
            {deeper && (
              <button type="button" title={`${crumbName(analysis, facts.tree, deeper)} に入る`} onClick={() => dispatch({ id: 'map.enter', group: deeper })} onKeyDown={stopKeys}>
                ›
              </button>
            )}
          </div>
          {body}
          {s.to === null && (
            <span className="gfin-off">
              <span className="mk">差分なし</span>
              <code>{s.callee}</code>
            </span>
          )}
        </div>
      );
    }
  }
  return (
    <>
      <svg className="gflow" width={view.w} height={view.h} aria-hidden="true">
        <defs>
          <marker id="gfarrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
        {draw.arrows.map((a) => (
          <polyline key={a.n} className={`gfp ${a.state}`} points={a.pts.map((p) => p.map(Math.round).join(',')).join(' ')} markerEnd="url(#gfarrow)" />
        ))}
        {dots.map(([x, y]) => (
          <circle key={`${x},${y}`} className="gcdot" cx={x} cy={y} r="5">
            <title>呼び出し元（この図の外）</title>
          </circle>
        ))}
        {moving !== null && cur?.arrow && <Token key={moving} className="gtok gftok" pts={cur.arrow.pts} ms={moveMs(speed)} onDone={() => onArrive(moving)} />}
      </svg>
      {label}
    </>
  );
}

interface SeqViewProps {
  view: PlacedView;
  facts: MapFacts;
  steps: readonly FlowStep[];
  rows: readonly SeqRow[];
  layout: SeqLayout;
  step: number;
  args: boolean;
  nameOf: (id: string) => { text: string; guess: boolean };
  bandName: (layer: number) => string;
  dispatch: (c: Command) => void;
}

/** シーケンス図。列の頭はいまの図の item（data-id が地図の箱と同じ。切り替えると箱が列の頭へ動く） */
export function SeqView({ view, facts, steps, rows, layout, step, args, nameOf, bandName, dispatch }: SeqViewProps) {
  const L = layout;
  const byId = new Map(view.items.map((it) => [it.id, it]));
  const lane = new Map(L.lanes.map((l) => [l.id, l]));
  const hot = new Set(step === 0 ? [] : rows.filter((r) => r.n === step).flatMap((r) => (r.place.t === 'arrow' ? [r.place.a, r.place.b] : r.place.at === null ? [] : [r.place.at])));
  if (L.lanes.length === 0) return <div className="empty">この動きは、この図の中を通りません</div>;
  const xOf = (id: string) => (id === CALLER ? L.callerX : lane.get(id)!.cx);
  let last = 0;
  return (
    <>
      {L.bands.map((b, k) => (
        <div key={b.layer} className={`gsqband${k % 2 ? ' alt' : ''}`} style={{ left: b.x, width: b.w, height: L.h }}>
          <span>{bandName(b.layer)}</span>
        </div>
      ))}
      <svg className="gseq" width={L.w} height={L.h} aria-hidden="true">
        <defs>
          <marker id="gsarrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
        {L.lanes.map((l) => (
          <line key={l.id} className="gsq-life" x1={l.cx} y1={l.y + l.h} x2={l.cx} y2={L.h - 6} />
        ))}
        {rows.map((r, k) => {
          const y = L.ys[k]!;
          const st = rowState(r.n, step);
          const p = r.place;
          if (p.t === 'arrow') {
            const xa = xOf(p.a);
            const xb = xOf(p.b);
            const dir = xb > xa ? 1 : -1;
            const x1 = p.a === CALLER ? xa + 4 : xa + dir * 3;
            const x2 = p.b === CALLER ? xb + 6 : xb - dir * 3;
            return (
              <g key={k} className={`gsq-m ${st}${r.ret ? ' ret' : ''}`}>
                <line x1={x1} y1={y} x2={x2} y2={y} markerEnd="url(#gsarrow)" />
                {(p.a === CALLER || p.b === CALLER) && (
                  <circle className="gcdot" cx={L.callerX} cy={y} r="3.5">
                    <title>呼び出し元（この図の外）</title>
                  </circle>
                )}
              </g>
            );
          }
          if (p.at === null || !lane.has(p.at)) return null;
          const cx = lane.get(p.at)!.cx;
          return (
            <g key={k} className={`gsq-m ${st}${r.ret ? ' ret' : ''}`}>
              <path d={`M${cx},${y - 6} h 26 v 12 h -22`} markerEnd="url(#gsarrow)" />
            </g>
          );
        })}
      </svg>
      {rows.map((r, k) => {
        const y = L.ys[k]!;
        const st = rowState(r.n, step);
        const s = steps[r.n - 1]!;
        const num =
          !r.ret && r.n !== last ? (
            <span key={`n${k}`} className={`gsq-n ${st === 'hot' ? 'cur' : st}`} style={{ top: y }}>
              {r.n}
            </span>
          ) : null;
        if (!r.ret) last = r.n;
        const text = r.ret ? `↩ ${s.returns ?? ''}` : textOf(s, args);
        const extra = !r.ret && s.to === null ? `（差分なし ${s.callee}）` : '';
        const cap = L.w - 24;
        const w = Math.min(cap, textW(text + extra) * 0.95 + 14);
        const p = r.place;
        let style: CSSProperties;
        if (p.t === 'arrow') {
          const mid = (xOf(p.a) + xOf(p.b)) / 2;
          style = { left: Math.min(L.w - w / 2 - 2, Math.max(w / 2 + 18, mid)), top: y - 9, transform: 'translate(-50%,-50%)' };
        } else if (p.at !== null && lane.has(p.at)) {
          const cx = lane.get(p.at)!.cx;
          const right = cx + 34 + w <= L.w;
          style = { left: right ? cx + 34 : Math.max(cx - 6, w + 18), top: y, transform: `translate(${right ? '0' : '-100%'},-50%)` };
        } else style = { left: L.w / 2, top: y, transform: 'translate(-50%,-50%)' };
        return (
          <Fragment key={k}>
            {num}
            {r.ret ? (
              <span className={`gsq-l ret ${st}`} style={style}>
                {text}
              </span>
            ) : (
              <button type="button" className={`gsq-l ${st}`} style={{ ...style, maxWidth: cap }} title={argsTitle(s, args)} onClick={() => dispatch({ id: 'map.args' })} onKeyDown={stopKeys}>
                {p.t === 'in' && p.at === null ? `この図の外 · ${text}` : text}
                {extra && <small>{extra}</small>}
              </button>
            )}
          </Fragment>
        );
      })}
      {L.lanes.map((l) => {
        const it = byId.get(l.id)!;
        const pos: CSSProperties = { left: l.x, top: l.y, width: l.w, height: l.h };
        const name = it.kind === 'box' ? (it.short ?? facts.tree.boxes.get(l.id)?.label ?? l.id) : nameOf(l.id).text;
        const go = it.kind === 'box' ? null : facts.tree.groups.has(l.id) ? l.id : (facts.tree.parent.get(l.id) ?? null);
        const course = facts.tree.boxes.get(l.id)?.course;
        return (
          <button
            key={l.id}
            type="button"
            data-id={l.id}
            className={`gsqh ${it.kind}${hot.has(l.id) ? ' hot' : ''}${facts.box.get(l.id)?.added ? ' add' : ''}`}
            style={pos}
            title={it.kind === 'box' ? (facts.tree.boxes.get(l.id)?.path ?? name) : `${name} に入る`}
            onClick={() => (go !== null ? dispatch({ id: 'map.enter', group: go }) : course !== undefined && dispatch({ id: 'home.select', courseId: course }))}
            onKeyDown={stopKeys}
          >
            {it.kind === 'box' ? <Short text={name} /> : <span className={nameOf(l.id).guess ? 'guess' : ''}>{name}</span>}
          </button>
        );
      })}
    </>
  );
}

interface BehaviorPlayerProps {
  view: PlacedView;
  facts: MapFacts;
  analysis: Analysis;
  behavior: Behavior;
  steps: readonly FlowStep[];
  step: number;
  play: boolean;
  speed: number;
  mode: 'map' | 'seq';
  dispatch: (c: Command) => void;
}

/** 動きの再生の帯（▶・前・次・歩の帯・速さ・地図 / シーケンス図）と、今の歩の 1 行。歩が別の図で起きていれば「… で見る ›」 */
export function BehaviorPlayer({ view, facts, analysis, behavior, steps, step, play, speed, mode, dispatch }: BehaviorPlayerProps) {
  const n = steps.length;
  const cur = step > 0 ? steps[step - 1] : undefined;
  const boxes = cur ? stepBoxes(cur) : steps.flatMap(stepBoxes);
  const where = boxes.length > 0 ? whereTo(facts.tree, view.spec, boxes) : null;
  const whereLabel = where
    ? where.under
      ? `${(pathTo(facts.tree, where.to) ?? [])
          .slice(pathTo(facts.tree, view.spec.at)?.length ?? 0)
          .map((id) => crumbName(analysis, facts.tree, id))
          .join(' › ')} の中で見る`
      : `${crumbName(analysis, facts.tree, where.to)} で見る`
    : '';
  return (
    <>
      <div className="gplay beh" role="group" aria-label={`動き「${behavior.title}」`}>
        <button type="button" className="pri" title={play ? '止める' : '再生'} aria-label={play ? '止める' : '再生'} onClick={() => dispatch({ id: 'map.play' })}>
          {play ? '❚❚' : '▶'}
        </button>
        <button type="button" title="前の歩" aria-label="前の歩" onClick={() => dispatch({ id: 'map.step', to: step - 1 })} disabled={step === 0}>
          ◀ <Key action="course.prev" />
        </button>
        <button type="button" title="次の歩" aria-label="次の歩" onClick={() => dispatch({ id: 'map.step', to: step + 1 })} disabled={step >= n}>
          ▶▶ <Key action="course.forward" />
        </button>
        <span className="gpl-seg">
          {steps.map((s) => (
            <button
              key={s.n}
              type="button"
              className={`${s.to === null ? 'off' : ''}${s.n === step ? ' cur' : ''}${step > 0 && s.n > step ? ' fut' : ''}`}
              title={`${s.n} 歩目: ${s.caller} → ${s.callee}`}
              aria-label={`${s.n} 歩目`}
              onClick={() => dispatch({ id: 'map.step', to: s.n })}
            />
          ))}
        </span>
        <span className="gpl-n">{`${step}/${n}`}</span>
        <SpeedControl speed={speed} dispatch={dispatch} />
        <span className="seg" role="group" aria-label="見せ方">
          {(
            [
              ['map', '地図'],
              ['seq', 'シーケンス図'],
            ] as const
          ).map(([k, t]) => (
            <button key={k} type="button" aria-pressed={mode === k} className={mode === k ? 'on' : ''} onClick={() => dispatch({ id: 'home.mode', mode: k })} onKeyDown={stopKeys}>
              {t}
            </button>
          ))}
        </span>
      </div>
      <div className="gpl-cap">
        {cur ? (
          <span className="t">
            <code>{`${cur.caller} → ${cur.callee}`}</code>
            {cur.to === null && <span className="mk">差分なし</span>}
          </span>
        ) : (
          <span className="t">
            <span className={behavior.titleProvenance === 'llm' ? 'guess' : ''}>{behavior.title}</span>
            {`。呼び出し元から ${n} 歩`}
          </span>
        )}
        {where && (
          <button type="button" className="gwhere" onClick={() => dispatch({ id: 'map.enter', group: where.to })} onKeyDown={stopKeys}>
            {`${whereLabel} ›`}
          </button>
        )}
      </div>
    </>
  );
}

/** 帯の名前（構成の推定から来た帯は「（推定）」。GroupMap の Bands と同じ） */
export function bandNameOf(analysis: Analysis, bands: readonly string[]): (layer: number) => string {
  const guessed = analysis.config.layers.length === 0 && (analysis.structure?.layers?.length ?? 0) > 0;
  return (layer) => {
    const name = bands[layer] ?? NO_LAYER;
    return guessed && name !== NO_LAYER ? `${name}（推定）` : name;
  };
}
