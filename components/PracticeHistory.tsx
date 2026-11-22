"use client";

import { useState } from "react";
import type { HistoryFile } from "@/lib/practice-history";
import { attemptNumbers, type DayLogEntry } from "@/lib/practice-daylog";
import { progressPoints, summarizeProgress, type GameRow } from "@/lib/practice-history";
import type { BatchSummary, DayResult, GameState } from "@/lib/practice-engine";
import { formatCents, formatSignedPercent, formatWholeDollars } from "@/lib/simulator";

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function prettyPlayed(iso: string): string {
  if (!iso) return "—";
  const parsed = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function prettyDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function signedDollars(value: number): string {
  const text = formatWholeDollars(Math.abs(value));
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

export function PracticeHistory({
  history,
  game,
  rows,
  pending,
  onExport,
  onImport,
  onNewGame,
  onDelete,
  onDeleteAll,
  notice,
  dayLog,
  onDeleteDay,
}: {
  history: HistoryFile;
  game: GameState;
  rows: GameRow[];
  pending: DayResult[];
  onExport: () => void;
  onImport: (file: File) => void;
  onNewGame: () => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  notice: string | null;
  dayLog: DayLogEntry[];
  onDeleteDay: (id: string) => void;
}) {
  const [mode, setMode] = useState<"return" | "win">("return");
  const [open, setOpen] = useState<string | null>("this");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const points = progressPoints(history, game.history.batches);
  const summary = summarizeProgress(history, game.history.batches, pending, rows.some((row) => row.id === "this"));

  return (
    <section className="pr-review">
      <h2>History</h2>
      <p className="pr-note">Every finished game stays here. New game does not erase it.</p>
      <dl className="pr-stats">
        <Stat label="Games" value={String(summary.games)} />
        <Stat label="Batches" value={String(summary.batches)} />
        <Stat label="Avg batch" value={formatSignedPercent(summary.avgReturn)} tone={summary.avgReturn ?? 0} />
        <Stat label="Best batch" value={formatSignedPercent(summary.bestReturn)} tone={summary.bestReturn ?? 0} />
        <Stat label="Improvement" value={formatSignedPercent(summary.improvement)} tone={summary.improvement ?? 0} />
        <Stat label="Day streak" value={summary.streak === null ? "—" : String(summary.streak)} tone={summary.streak ?? 0} />
      </dl>
      <p className="pr-note">Improvement is the last 5 batch returns minus the first 5. The streak is positive days in a row, latest first.</p>
      <div className="pr-toggle" role="group" aria-label="Progress chart">
        <button type="button" aria-pressed={mode === "return"} onClick={() => setMode("return")}>
          Return %
        </button>
        <button type="button" aria-pressed={mode === "win"} onClick={() => setMode("win")}>
          Win rate %
        </button>
      </div>
      <ProgressChart points={points} mode={mode} />
      <DaysPlayed entries={dayLog} onDelete={onDeleteDay} />
      {rows.length === 0 ? <p className="pr-note">Finish a 5-day batch and it will show up here.</p> : null}
      <div className="pr-cards">
        {rows.map((row) => (
          <article key={row.id} className="pr-card">
            <button type="button" className="pr-card-hit" aria-expanded={open === row.id} onClick={() => setOpen(open === row.id ? null : row.id)}>
              <span>
                <strong>{row.title}</strong>
                <span className="pr-note">
                  {prettyPlayed(row.playedAt)} · {countLabel(row.batches.length, "batch")} · {countLabel(row.days, "day")}
                </span>
              </span>
              <strong className={row.returnPct >= 0 ? "up" : "down"}>{formatSignedPercent(row.returnPct)}</strong>
            </button>
            <dl className="pr-kv">
              <div>
                <dt>Ending</dt>
                <dd>{formatWholeDollars(row.ending)}</dd>
              </div>
              <div>
                <dt>Return</dt>
                <dd className={row.returnPct >= 0 ? "up" : "down"}>{formatSignedPercent(row.returnPct)}</dd>
              </div>
              <div>
                <dt>Win rate</dt>
                <dd>{row.winRate === null ? "—" : formatSignedPercent(row.winRate).replace("+", "")}</dd>
              </div>
              <div>
                <dt>Trades</dt>
                <dd>{row.trades}</dd>
              </div>
              <div>
                <dt>Fees</dt>
                <dd>{formatCents(row.fees)}</dd>
              </div>
              <div>
                <dt>Slippage</dt>
                <dd>{row.slippage === null ? "—" : formatCents(row.slippage)}</dd>
              </div>
              <div>
                <dt>Vs hold TQQQ</dt>
                <dd className={row.vsHold >= 0 ? "up" : "down"}>{signedDollars(row.vsHold)}</dd>
              </div>
            </dl>
            {open === row.id ? <BatchList batches={row.batches} /> : null}
            {row.id !== "this" && confirmId === row.id ? (
              <div className="pr-confirm">
                <p className="pr-lead">Delete Game #{row.number}? This can't be undone.</p>
                <div className="pr-actions">
                  <button type="button" className="text-btn" onClick={() => setConfirmId(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="pr-delete"
                    onClick={() => {
                      onDelete(row.id);
                      setConfirmId(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : row.id !== "this" ? (
              <button type="button" className="text-btn" onClick={() => setConfirmId(row.id)}>
                Delete
              </button>
            ) : null}
          </article>
        ))}
      </div>
      <div className="pr-actions">
        <button type="button" className="text-btn" onClick={onExport}>
          Export history
        </button>
        <label className="text-btn pr-file">
          Import history
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onImport(file);
            }}
          />
        </label>
        <button type="button" className="text-btn" onClick={onNewGame}>
          New game
        </button>
        {history.games.length > 0 ? (
          <button type="button" className="text-btn" onClick={() => setConfirmAll(true)}>
            Delete all history
          </button>
        ) : null}
      </div>
      {confirmAll ? (
        <div className="pr-confirm">
          <p className="pr-lead">Delete all history? This can't be undone.</p>
          <div className="pr-actions">
            <button type="button" className="text-btn" onClick={() => setConfirmAll(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="pr-delete"
              onClick={() => {
                onDeleteAll();
                setConfirmAll(false);
                setConfirmId(null);
              }}
            >
              Delete all history
            </button>
          </div>
        </div>
      ) : null}
      {notice ? <p className="pr-note">{notice}</p> : null}
    </section>
  );
}

function BatchList({ batches }: { batches: BatchSummary[] }) {
  if (batches.length === 0) return <p className="pr-note">No finished batch yet.</p>;
  return (
    <div className="pr-batch-list">
      {batches.map((batch, index) => {
        const ret = batch.startEquity ? batch.endEquity / batch.startEquity - 1 : 0;
        const hold = batch.holdTqqq - batch.startEquity;
        return (
          <div key={`${batch.startDate}-${index}`}>
            <p className="pr-lead">
              Batch {index + 1} · {prettyDate(batch.startDate)} – {prettyDate(batch.endDate)} · {signedDollars(batch.endEquity - batch.startEquity)} {formatSignedPercent(ret)}
            </p>
            <ul className="pr-days">
              {batch.days.map((day, dayIndex) => (
                <li key={`${day.date}-${dayIndex}`}>
                  <span>Day {dayIndex + 1}</span>
                  <span>{prettyDate(day.date)}</span>
                  <strong className={day.dollars >= 0 ? "up" : "down"}>
                    {signedDollars(day.dollars)} {formatSignedPercent(day.pct)}
                  </strong>
                </li>
              ))}
            </ul>
            <p className="pr-note">
              Win rate {batch.winRate === null ? "—" : formatSignedPercent(batch.winRate).replace("+", "")} · Fees {formatCents(batch.fees)} · Slippage {typeof batch.slippage === "number" ? formatCents(batch.slippage) : "—"} · Vs hold {signedDollars(batch.endEquity - batch.startEquity - hold)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function ProgressChart({ points, mode }: { points: BatchPointView[]; mode: "return" | "win" }) {
  if (points.length === 0) return <p className="pr-note">Finish a 5-day batch to plot your progress.</p>;
  const values = points.map((point) => (mode === "return" ? point.returnPct : point.winRate ?? 0) * 100);
  const width = 640;
  const height = 220;
  const left = 52;
  const right = 12;
  const top = 16;
  const bottom = 32;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values, 1);
  const span = max - min || 1;
  const x = (index: number) => (points.length === 1 ? (left + width - right) / 2 : left + (index / (points.length - 1)) * (width - left - right));
  const y = (value: number) => top + (1 - (value - min) / span) * (height - top - bottom);
  const line = values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const ticks = xTicks(points.length);
  const yTicks = [...new Set([min, 0, max])].sort((a, b) => a - b);
  const label = mode === "return" ? "Batch return percent" : "Batch win rate percent";
  return (
    <svg className="pr-progress" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} className="zero" />
      {yTicks.map((tick) => (
        <text key={tick} x={left - 8} y={y(tick) + 4} textAnchor="end">
          {tick > 0 ? "+" : ""}
          {tick.toFixed(0)}%
        </text>
      ))}
      <path className="line" d={line} />
      {values.map((value, index) => (
        <circle key={index} cx={x(index)} cy={y(value)} r="3.5" />
      ))}
      {ticks.map((index) => (
        <text key={index} x={x(index)} y={height - 8} textAnchor="middle">
          {index + 1}
        </text>
      ))}
    </svg>
  );
}

type BatchPointView = { returnPct: number; winRate: number | null };

function xTicks(count: number): number[] {
  if (count <= 1) return [0];
  const marks = new Set<number>([0, count - 1]);
  const inner = Math.min(4, count - 2);
  for (let step = 1; step <= inner; step += 1) marks.add(Math.round((step * (count - 1)) / (inner + 1)));
  return [...marks].sort((a, b) => a - b);
}

function Stat({ label, value, tone = 0 }: { label: string; value: string; tone?: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={tone > 0 ? "up" : tone < 0 ? "down" : undefined}>{value}</dd>
    </div>
  );
}

function longDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function signedCents(value: number): string {
  const text = formatCents(Math.abs(value));
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

/** Every attempt at a practice day, newest first: days played to 10:00 and days stopped with Reset. */
function DaysPlayed({ entries, onDelete }: { entries: DayLogEntry[]; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const attempts = attemptNumbers(entries);
  const newest = [...entries].reverse();
  return (
    <>
      <h3>Days played</h3>
      {newest.length === 0 ? <p className="pr-note">Each day you finish or reset is saved here with its market date.</p> : null}
      <div className="pr-cards">
        {newest.map((entry) => {
          const attempt = attempts.get(entry.id) ?? 1;
          return (
            <article key={entry.id} className="pr-card">
              <button type="button" className="pr-card-hit" aria-expanded={open === entry.id} onClick={() => setOpen(open === entry.id ? null : entry.id)}>
                <span>
                  <strong>{longDate(entry.date)}</strong>
                  <span className="pr-note">
                    {entry.outcome === "finished" ? "Played to 10:00" : `Reset at ${entry.stoppedAt}`}
                    {attempt > 1 ? ` · attempt ${attempt}` : ""} · played {prettyPlayed(entry.recordedAt)}
                  </span>
                </span>
                <strong className={entry.dollars >= 0 ? "up" : "down"}>{formatSignedPercent(entry.pct)}</strong>
              </button>
              <dl className="pr-kv">
                <div>
                  <dt>P/L</dt>
                  <dd className={entry.dollars >= 0 ? "up" : "down"}>{signedCents(entry.dollars)}</dd>
                </div>
                <div>
                  <dt>Start</dt>
                  <dd>{formatCents(entry.startCash)}</dd>
                </div>
                <div>
                  <dt>End</dt>
                  <dd>{formatCents(entry.endEquity)}</dd>
                </div>
                <div>
                  <dt>Fills</dt>
                  <dd>{entry.fills.length}</dd>
                </div>
                <div>
                  <dt>Fees</dt>
                  <dd>{formatCents(entry.fees)}</dd>
                </div>
                <div>
                  <dt>Slippage</dt>
                  <dd>{formatCents(entry.slippage)}</dd>
                </div>
              </dl>
              {open === entry.id ? (
                <>
                  {entry.fills.length === 0 ? <p className="pr-note">No trades.</p> : null}
                  <ul className="pr-days">
                    {entry.fills.map((fill, index) => (
                      <li key={index}>
                        9:{String(30 + fill.minute).padStart(2, "0")} · {fill.side === "buy" ? "Buy" : "Sell"} {fill.shares} {fill.ticker} at {formatCents(fill.price)} · slippage {formatCents(fill.slippage)}
                      </li>
                    ))}
                  </ul>
                  {entry.open.length ? (
                    <p className="pr-note">Still held at reset: {entry.open.map((held) => `${held.shares} ${held.ticker}`).join(", ")} (valued at the last price).</p>
                  ) : null}
                  {confirm === entry.id ? (
                    <div className="pr-actions">
                      <button type="button" className="pr-delete" onClick={() => onDelete(entry.id)}>
                        Delete this day
                      </button>
                      <button type="button" className="text-btn" onClick={() => setConfirm(null)}>
                        Keep
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="text-btn" onClick={() => setConfirm(entry.id)}>
                      Delete
                    </button>
                  )}
                </>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}
