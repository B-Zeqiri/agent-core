export type ExplainabilityData = {
  taskTypeLabel?: string;
  schedulerLabel?: string;
  agentId?: string;
  agentName?: string;
  manuallySelected?: boolean;
  agentSelectionReason?: string;
  availableAgents?: string[];
  successRatePercent?: number;
  loadScore?: number;
};

function clampPercent(value: number | undefined): number | undefined {
  if (value == null || Number.isNaN(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export default function ExplainabilityPanel({
  data,
}: {
  data: ExplainabilityData | null;
}) {
  if (!data) return null;

  const load = clampPercent(data.loadScore);
  const rate = clampPercent(data.successRatePercent);

  const MetricRow = ({
    label,
    value,
    accent,
    barFrom,
    barTo,
  }: {
    label: string;
    value: number;
    accent: string;
    barFrom: string;
    barTo: string;
  }) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-gray-400">{label}</span>
        <span className={`font-semibold ${accent}`}>{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-brand-dark/60 border border-brand-border/50 overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${barFrom} ${barTo}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );

  const showAny = Boolean(
    data.taskTypeLabel ||
      data.schedulerLabel ||
      data.agentSelectionReason ||
      data.availableAgents?.length ||
      rate != null ||
      load != null
  );

  if (!showAny) return null;

  return (
    <div className="mt-3 rounded-lg border border-brand-accent/20 bg-gradient-to-b from-brand-panel/60 to-brand-dark/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-accent" />
          <div className="text-xs font-bold text-white uppercase tracking-wider truncate">
            Why this agent?
          </div>
          {data.manuallySelected != null && (
            <span
              className={
                'flex-shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full border ' +
                (data.manuallySelected
                  ? 'border-orange-500/40 bg-orange-500/10 text-orange-400'
                  : 'border-brand-accent/40 bg-brand-accent/10 text-brand-accent')
              }
              title={data.manuallySelected ? 'Manually selected' : 'Auto-selected'}
            >
              {data.manuallySelected ? 'manual' : 'auto'}
            </span>
          )}
        </div>

        {(rate != null || load != null) && (
          <div className="w-40 flex-shrink-0 grid grid-cols-2 gap-3">
            {rate != null ? (
              <MetricRow
                label="Success"
                value={rate}
                accent="text-brand-success"
                barFrom="from-brand-success"
                barTo="to-brand-accent"
              />
            ) : (
              <div />
            )}
            {load != null ? (
              <MetricRow
                label="Load"
                value={load}
                accent="text-brand-accent"
                barFrom="from-brand-accent"
                barTo="to-blue-400"
              />
            ) : (
              <div />
            )}
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1 text-xs text-gray-200">
        {data.taskTypeLabel && (
          <div className="flex gap-2">
            <span className="text-gray-400">Classified:</span>
            <span className="text-white/90">{data.taskTypeLabel}</span>
          </div>
        )}

        {data.schedulerLabel && (
          <div className="flex gap-2">
            <span className="text-gray-400">Selected by:</span>
            <span className="text-white/90">{data.schedulerLabel}</span>
          </div>
        )}

        {data.agentSelectionReason && (
          <div className="text-gray-300 line-clamp-2" title={data.agentSelectionReason}>
            {data.agentSelectionReason}
          </div>
        )}

        {data.availableAgents && data.availableAgents.length > 0 && (
          <div className="text-[11px] text-gray-400">
            Candidates: {data.availableAgents.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
