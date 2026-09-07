import { useMemo, useState } from "react";
import type { DynastyState, Player, SeasonStats } from "./engine/types.ts";
import { Card, TeamName } from "./ui.tsx";
import { PlayerCard } from "./panels.tsx";

const CATEGORIES: { key: keyof SeasonStats; label: string }[] = [
  { key: "paYd", label: "Passing yards" }, { key: "paTD", label: "Passing TDs" },
  { key: "ruYd", label: "Rushing yards" }, { key: "ruTD", label: "Rushing TDs" },
  { key: "reYd", label: "Receiving yards" }, { key: "rec", label: "Receptions" },
  { key: "reTD", label: "Receiving TDs" }, { key: "tkl", label: "Tackles" },
  { key: "sck", label: "Sacks" }, { key: "int", label: "Interceptions" },
  { key: "fgm", label: "Field goals" },
];

export default function SeasonLeaders({ state }: { state: DynastyState }) {
  const [category, setCategory] = useState<keyof SeasonStats>("paYd");
  const [scope, setScope] = useState("national");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const user = state.teams[state.userTid];
  const leaders = useMemo(() => state.teams
    .filter(t => t.p4 && (scope === "national" || (scope === "team" ? t.id === user.id : t.conference === user.conference)))
    .flatMap(team => team.roster.map(id => ({ team, player: state.players[id] })))
    .filter(({ player }) => player && player.stats[category] > 0)
    .sort((a, b) => b.player.stats[category] - a.player.stats[category] || a.player.name.localeCompare(b.player.name))
    .slice(0, 50), [state, category, scope, user]);
  const selected: Player | undefined = selectedId === null ? undefined : state.players[selectedId];
  const label = CATEGORIES.find(c => c.key === category)!.label;

  return <div className="space-y-3">
    <Card title={`${state.season} · SEASON LEADERS`}>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs">Statistic
          <select className="ml-2 rounded border border-line bg-surface-raised p-2" value={category}
            onChange={e => setCategory(e.target.value as keyof SeasonStats)}>
            {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="text-xs">Scope
          <select className="ml-2 rounded border border-line bg-surface-raised p-2" value={scope} onChange={e => setScope(e.target.value)}>
            <option value="national">All simulated programs</option>
            <option value="conference">{user.conference}</option>
            <option value="team">{user.school}</option>
          </select>
        </label>
      </div>
      <p className="mt-3 text-xs text-ink/60">Season totals, including postseason. Select a player to see attributes, career history and awards. Opponents without full rosters are excluded.</p>
    </Card>
    <Card title={label.toUpperCase()} bodyClassName="p-0">
      {leaders.length === 0 ? <p className="p-5 text-sm text-ink/60">No {label.toLowerCase()} recorded yet. Play or simulate a week to start the leaderboard.</p> :
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="border-b border-line text-xs text-ink/60">
            {['Rank', 'Player', 'Team', 'GP', label, 'Per game'].map(h => <th key={h} className="px-3 py-2" scope="col">{h}</th>)}
          </tr></thead>
          <tbody>{leaders.map(({ player: p, team }, i) => <tr key={p.id} className={`border-b border-line/50 ${team.id === user.id ? 'bg-accent-soft' : ''}`}>
            <td className="px-3 py-2 font-mono">{i + 1}</td>
            <td className="px-3 py-2"><button className="text-left font-medium underline decoration-line underline-offset-4 hover:text-accent" onClick={() => setSelectedId(p.id)}>{p.name}</button><span className="ml-2 text-xs text-ink/50">{p.pos}</span></td>
            <td className="px-3 py-2"><TeamName team={team} /></td>
            <td className="px-3 py-2 font-mono">{p.stats.gp}</td>
            <td className="px-3 py-2 font-mono font-bold">{p.stats[category].toLocaleString()}</td>
            <td className="px-3 py-2 font-mono">{p.stats.gp > 0 ? (p.stats[category] / p.stats.gp).toFixed(1) : '—'}</td>
          </tr>)}</tbody>
        </table></div>}
    </Card>
    {selected && <PlayerCard state={state} player={selected} onClose={() => setSelectedId(null)} />}
  </div>;
}
