// 入口の地図の部品で、コースの道順と動きの両方が使うもの（玉・速さのつまみ・コースの色）。描くだけ
import { Fragment, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Command } from '../commands/commands.js';
import { along, snapSpeed, SPEED_MAX, SPEED_MIN, SPEED_SNAP } from '../map/groupmap/flow.js';

/** コースの色（App が根元に置く --c<番号>） */
export const ccOf = (id: number): CSSProperties => ({ ['--cc' as string]: `var(--c${id})` });

/** Enter / Space はこの部品だけのもの（App の Enter =「選んだコースに入る」に流さない） */
export const stopKeys = (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
};

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 玉。線の上を前の箱から今の箱へ動く（React の外で毎フレーム属性を書く） */
export function Token({ pts, ms, onDone, className = 'gtok' }: { pts: Array<[number, number]>; ms: number; onDone: () => void; className?: string }) {
  const ref = useRef<SVGCircleElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const [x, y] = along(pts, e);
      ref.current?.setAttribute('cx', String(x));
      ref.current?.setAttribute('cy', String(y));
      if (t < 1) raf = requestAnimationFrame(frame);
      else done.current();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [pts, ms]);
  return <circle ref={ref} className={className} r="5.5" cx={pts[0]![0]} cy={pts[0]![1]} />;
}

/** 再生の速さのつまみ。動かしている間は画面の数だけ変え、止まってから保存する（ui.json への書き込みを減らす） */
export function SpeedControl({ speed, dispatch }: { speed: number; dispatch: (c: Command) => void }) {
  const [spd, setSpd] = useState(speed);
  useEffect(() => setSpd(speed), [speed]);
  useEffect(() => {
    if (spd === speed) return;
    const t = setTimeout(() => dispatch({ id: 'map.speed', speed: spd }), 250);
    return () => clearTimeout(t);
  }, [spd, speed, dispatch]);
  return (
    <label className="gspd" title="再生の速さ（0.5 刻みの数に吸い付く）">
      <input
        type="range"
        min={SPEED_MIN}
        max={SPEED_MAX}
        step={0.01}
        value={spd}
        list="gspd-snap"
        aria-label="再生の速さ"
        onChange={(e) => setSpd(snapSpeed(Number(e.target.value)))}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <datalist id="gspd-snap">
        {SPEED_SNAP.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <output>{`${+spd.toFixed(2)}×`}</output>
    </label>
  );
}

/** 「…」を薄くし、キャメルケースの切れ目で折り返せるようにする */
export function Short({ text }: { text: string }) {
  const parts = text.split('…');
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <i className="el">…</i>}
          {p.split(/(?<=[a-z\d])(?=[A-Z])/).map((w, k) => (
            <Fragment key={k}>
              {k > 0 && <wbr />}
              {w}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  );
}

