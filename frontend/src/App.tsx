import { useState } from 'react';
import TopBar from './components/TopBar';
import MainWorkspace from './components/MainWorkspace';
import AgentSidebar from './components/AgentSidebar';
import SchedulerPanel from './components/SchedulerPanel';
import Timeline from './components/Timeline';
import ParticleField from './components/ParticleField';
import FailureTestPage from './components/FailureTestPage';
import './index.css';

export type UIState = 'idle' | 'submitting' | 'queued' | 'running' | 'completed' | 'failed';

export type GenerationMode = 'creative' | 'deterministic';

export interface GenerationConfig {
  mode: GenerationMode;
  temperature?: number;
  maxTokens?: number;
  seed?: number;
}

export interface Task {
  id: string;
  status: string;
  agent: string;
  input: string;
  progress: number;
  messages: string[];
  generation?: GenerationConfig;
  output?: string;
  error?: string;
  errorCode?: string;
  failedLayer?: string;
  stackTrace?: string;
  suggestions?: string[];
  startedAt: number;
  durationMs?: number;
}

export interface TimelineEvent {
  layer: string;
  status: 'pending' | 'active' | 'done' | 'error';
  timestamp: number;
}

function App() {
  const [uiState, setUiState] = useState<UIState>('idle');
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [activeAgents, setActiveAgents] = useState<string[]>([]);

  // Check if we're in test mode via URL parameter
  const isTestMode = new URLSearchParams(window.location.search).get('test') === 'failure';

  // Show test page if in test mode
  if (isTestMode) {
    return <FailureTestPage />;
  }

  return (
    <div className="flex flex-col h-screen bg-brand-dark relative">
      <ParticleField />
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 flex-shrink-0 flex flex-col gap-3 p-3">
          <SchedulerPanel />
          <AgentSidebar activeAgent={currentTask?.agent} activeAgents={activeAgents} />
        </div>
        <MainWorkspace
          uiState={uiState}
          currentTask={currentTask}
          onStateChange={setUiState}
          onTaskChange={setCurrentTask}
          onTimelineUpdate={setTimelineEvents}
          onActiveAgentsChange={setActiveAgents}
        />
      </div>
      <Timeline events={timelineEvents} />
    </div>
  );
}

export default App;
