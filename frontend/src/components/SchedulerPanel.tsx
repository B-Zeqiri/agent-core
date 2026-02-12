import  { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface SchedulerStatus {
  queuedTasks: number;
  avgLoad: number;
}

function SchedulerPanel() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/scheduler/status');
        if (res.ok) {
          setStatus(await res.json());
        }
      } catch (err) {
        console.error('Scheduler fetch error:', err);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!status) {
    return (
      <div className="w-full bg-gradient-to-b from-brand-dark to-brand-panel border border-brand-accent/20 rounded-lg p-3 shadow-xl">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse"></div>
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Scheduler</h3>
        </div>
        <div className="text-brand-muted text-sm flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-brand-accent border-t-transparent rounded-full animate-spin"></div>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="w-full bg-gradient-to-b from-brand-dark to-brand-panel border border-brand-accent/20 rounded-lg p-3 shadow-xl"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse"></div>
        <h3 className="text-xs font-bold text-white uppercase tracking-wider">Scheduler</h3>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-brand-panel/50 backdrop-blur-sm rounded-lg p-2 border border-brand-accent/20">
          <div className="text-[10px] text-brand-muted mb-1 font-semibold uppercase tracking-wide">Queue</div>
          <div className="text-2xl font-bold text-brand-accent">{status.queuedTasks}</div>
        </div>
        <div className="bg-brand-panel/50 backdrop-blur-sm rounded-lg p-2 border border-brand-accent/20">
          <div className="text-[10px] text-brand-muted mb-1 font-semibold uppercase tracking-wide">Avg Load</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-brand-dark rounded-full h-2 overflow-hidden border border-brand-accent/20">
              <motion.div
                className="h-full bg-gradient-to-r from-brand-accent to-brand-success rounded-full shadow-lg"
                initial={{ width: 0 }}
                animate={{ width: `${status.avgLoad}%` }}
                transition={{ duration: 0.5, type: "spring" }}
              />
            </div>
            <span className="text-xs font-bold text-white min-w-[2.5rem] text-right">{status.avgLoad}%</span>
          </div>
        </div>
      </div>

    </motion.div>
  );
}

export default SchedulerPanel;
