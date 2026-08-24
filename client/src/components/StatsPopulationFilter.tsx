import { useStatsPopulationContext, type StatsPopulation } from "../stats/stats-population.js";

const options: ReadonlyArray<{ value: StatsPopulation; label: string }> = [
  { value: "players", label: "Players only" },
  { value: "all", label: "Players + bots" }
];

export function StatsPopulationFilter() {
  const { population, setPopulation } = useStatsPopulationContext();

  return (
    <section className="panel stats-controls" aria-label="Statistics controls">
      <fieldset className="stats-population-fieldset" aria-describedby="statsPopulationHelp">
        <legend>Show</legend>
        <div className="stats-population-options">
          {options.map((option) => (
            <label className="stats-population-option" key={option.value}>
              <input
                type="radio"
                name="statsPopulation"
                value={option.value}
                checked={population === option.value}
                onChange={() => setPopulation(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p id="statsPopulationHelp" className="stats-control-help">
          Players + bots includes Playerbot-controlled activity.
        </p>
      </fieldset>
    </section>
  );
}
