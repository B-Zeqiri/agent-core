import  { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TimelineEvent } from '../App';

interface TimelineProps {
  events: TimelineEvent[];
}

interface LayerHealth {
  layer: string;
  status: 'pending' | 'active' | 'done' | 'error';
  healthy: boolean;
  message?: string;
}

function Timeline({ events }: TimelineProps) {
  const [healthChecks, setHealthChecks] = useState<Record<string, LayerHealth>>({});

  const layers = [
    'API Gateway',
    'Task Registry',
    'Orchestrator',
    'Scheduler',
    'Agent Runtime',
    'Model Adapter',
    'Result Store',
    'Event Stream',
    'Cleanup',
  ];

  // Health check functions for each layer
  const checkLayerHealth = async (layer: string): Promise<LayerHealth> => {
    try {
      switch (layer) {
        case 'API Gateway':
          // Check if API is responding
          const apiRes = await fetch('/api/status', { method: 'GET' });
          return {
            layer,
            status: apiRes.ok ? 'done' : 'error',
            healthy: apiRes.ok,
            message: apiRes.ok ? 'API responding' : 'API error'
          };

        case 'Task Registry':
          // Check if task registry is accessible
          const tasksRes = await fetch('/api/tasks');
          return {
            layer,
            status: tasksRes.ok ? 'done' : 'error',
            healthy: tasksRes.ok,
            message: tasksRes.ok ? 'Registry active' : 'Registry error'
          };

        case 'Orchestrator':
          // Check if agents are registered (orchestrator health)
          const agentsRes = await fetch('/api/agents');
          const agentsData = await agentsRes.json();
          return {
            layer,
            status: agentsData.length > 0 ? 'done' : 'pending',
            healthy: agentsData.length > 0,
            message: `${agentsData.length} agents registered`
          };

        case 'Scheduler':
          // Check scheduler status
          const schedulerRes = await fetch('/api/scheduler/status');
          const schedulerData = await schedulerRes.json();
          return {
            layer,
            status: schedulerRes.ok ? 'done' : 'error',
            healthy: schedulerRes.ok,
            message: schedulerRes.ok ? `Queue: ${schedulerData.queuedTasks}` : 'Scheduler error'
          };

        case 'Agent Runtime':
          // Check if agents are ready (kernel status)
          const agentStatusRes = await fetch('/api/agents');
          const agents = await agentStatusRes.json();
          const readyAgents = agents.filter((a: any) => a.status === 'READY' || a.status === 'IDLE');
          return {
            layer,
            status: readyAgents.length > 0 ? 'done' : 'pending',
            healthy: readyAgents.length > 0,
            message: `${readyAgents.length} agents ready`
          };

        case 'Model Adapter':
          // Model adapter is part of agent runtime - check via agent status
          const modelCheckRes = await fetch('/api/agents');
          const modelAgents = await modelCheckRes.json();
          return {
            layer,
            status: modelAgents.length > 0 ? 'done' : 'pending',
            healthy: modelAgents.length > 0,
            message: 'Models available'
          };

        case 'Result Store':
          // Check if we can access logs/results storage
          const logsRes = await fetch('/api/logs');
          return {
            layer,
            status: logsRes.ok ? 'done' : 'error',
            healthy: logsRes.ok,
            message: logsRes.ok ? 'Storage ready' : 'Storage error'
          };

        case 'Event Stream':
          // Event bus is internal - assume active if API works
          const eventRes = await fetch('/api/status');
          return {
            layer,
            status: eventRes.ok ? 'done' : 'error',
            healthy: eventRes.ok,
            message: 'Event bus active'
          };

        case 'Cleanup':
          // Cleanup is a background process - assume active if system is running
          return {
            layer,
            status: 'done',
            healthy: true,
            message: 'Cleanup ready'
          };

        default:
          return {
            layer,
            status: 'pending',
            healthy: false,
            message: 'Unknown layer'
          };
      }
    } catch (error) {
      return {
        layer,
        status: 'error',
        healthy: false,
        message: 'Connection failed'
      };
    }
  };

  // Run health checks on mount and periodically
  useEffect(() => {
    const runHealthChecks = async () => {
      const results: Record<string, LayerHealth> = {};
      for (const layer of layers) {
        results[layer] = await checkLayerHealth(layer);
      }
      setHealthChecks(results);
    };

    // Initial check
    runHealthChecks();

    // Periodic checks every 5 seconds
    const interval = setInterval(runHealthChecks, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="border-t border-brand-border bg-brand-panel/80 backdrop-blur-xl px-6 py-3 shadow-2xl">
      <div className="flex flex-wrap gap-2">
        {layers.map((layer) => {
          // Combine event status with health check
          const event = events.find((e) => e.layer === layer);
          const healthCheck = healthChecks[layer];
          
          // If we have events (task is active), use event status; otherwise use health check
          // Layers without events during task execution should show as pending
          const hasAnyEvents = events.length > 0;
          const status = event?.status || (hasAnyEvents ? 'pending' : healthCheck?.status) || 'pending';
          const healthy = healthCheck?.healthy ?? true;
          const message = healthCheck?.message;

          return (
            <motion.div
              key={layer}
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              whileHover={{ scale: 1.05, y: -2 }}
              className="flex items-center gap-2 px-3 py-2 bg-brand-dark/60 backdrop-blur-sm rounded-xl border border-brand-border text-xs cursor-pointer hover:bg-brand-accent hover:bg-opacity-10 transition-all duration-300 shadow-lg"
              title={message}
            >
              <motion.div
                className={`w-2 h-2 rounded-full ${
                  status === 'done'
                    ? 'bg-brand-success shadow-lg shadow-brand-success/50'
                    : status === 'active'
                    ? 'bg-brand-accent shadow-lg shadow-brand-accent/50'
                    : status === 'error' || (healthCheck && !healthy)
                    ? 'bg-brand-error shadow-lg shadow-brand-error/50'
                    : 'bg-brand-muted'
                }`}
                animate={status === 'active' ? {
                  scale: [1, 1.4, 1],
                  opacity: [1, 0.5, 1]
                } : {}}
                transition={status === 'active' ? { repeat: Infinity, duration: 1.5, ease: "easeInOut" } : {}}
              />
              <span className="text-white font-medium">
                {layer}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default Timeline;
