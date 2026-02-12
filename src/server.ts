import dotenv from "dotenv";
import express from "express";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { Kernel } from "./kernel/kernel";
import { Orchestrator } from "./orchestration/orchestrator";
import { Agent } from "./kernel/types";
import { Task as OrchestrationTask, TaskGraph } from "./orchestration/types";
// Import infrastructure components
import { taskRegistry } from "./registry/taskRegistry";
import { kernelScheduler } from "./scheduler/kernelScheduler";
import { ModelAdapterFactory, GPT4AllAdapter } from "./models/modelAdapter";
import { WebDevAgent } from "./agents/webDevAgent";
import { ResearchAgent, SystemAgent } from "./agents/researchAndSystemAgent";
import { resultStore } from "./storage/resultStore";
import { eventBus } from "./events/eventBus";
import { taskStore, TaskRecord } from "./storage/taskStore";

// Phase 2: Plugin agents (developer contract)
import { registerDefaultTools } from "./plugins/defaultTools";
import { loadAllPluginAgents } from "./plugins/pluginLoader";
import { pluginDefinitionToKernelAgent } from "./plugins/pluginRuntime";
import { abortPluginTask } from "./plugins/cancellation";
import { abortTask, cleanupTaskAbortController, getOrCreateTaskAbortController, getTaskAbortSignal, hasTaskAbortController } from "./cancellation/taskCancellation";
import { reloadAllPluginAgents } from "./plugins/pluginReloader";
import { startPluginWatcher } from "./plugins/pluginWatcher";

// Buffer plugin agents for the UI list (declared later in this file)
const pluginAgentsForUi: Array<{ id: string; name: string }> = [];

dotenv.config();

// --- System Mode (Assist, Power, Autonomous) ---
type SystemMode = 'assist' | 'power' | 'autonomous';
let systemMode: SystemMode = 'assist';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;

// Get current system mode
app.get('/api/system-mode', (_req, res) => {
  res.json({ mode: systemMode });
});

// Set system mode
app.post('/api/system-mode', (req, res) => {
  const mode = req.body?.mode;
  if (mode === 'assist' || mode === 'power' || mode === 'autonomous') {
    systemMode = mode;
    addLog('info', `System mode changed to ${mode}`);
    res.json({ ok: true, mode });
  } else {
    res.status(400).json({ ok: false, error: 'Invalid mode' });
  }
});

// Model configuration (Phase 4)
// Exposes resolved model routing config for debugging and UI.
// Never returns secrets.
app.get('/api/models', (_req, res) => {
  const normalize = (s: string) => s.trim().toLowerCase();
  const parseList = (s: string) =>
    s
      .split(',')
      .map(x => normalize(x))
      .filter(Boolean);

  const chainRaw = String(process.env.MODEL_CHAIN || '').trim();
  const providerRaw = String(process.env.MODEL_PROVIDER || '').trim();

  const chain = chainRaw ? parseList(chainRaw) : [];
  const resolvedChain = chain.length ? chain : [normalize(providerRaw || 'gpt4all')];

  const temperatureEnv = process.env.MODEL_TEMPERATURE;
  const maxTokensEnv = process.env.MODEL_MAX_TOKENS;

  const temperature = temperatureEnv != null && temperatureEnv !== '' ? Number(temperatureEnv) : undefined;
  const maxTokens = maxTokensEnv != null && maxTokensEnv !== '' ? Number(maxTokensEnv) : undefined;

  res.json({
    ok: true,
    mode: chain.length ? 'chain' : 'single',
    provider: normalize(providerRaw || 'gpt4all'),
    chain: resolvedChain,
    settings: {
      temperature: Number.isFinite(temperature as number) ? temperature : undefined,
      maxTokens: Number.isFinite(maxTokens as number) ? maxTokens : undefined,
    },
    providers: {
      gpt4all: {
        baseURL: process.env.GPT4ALL_BASE_URL || 'http://localhost:4891/v1',
        model: process.env.GPT4ALL_MODEL || 'gpt4all',
      },
      ollama: {
        baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        model: process.env.OLLAMA_MODEL || 'llama3.1',
      },
      openai: {
        baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        apiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
      },
    },
  });
});

// Initialize Kernel and Orchestrator
const kernel = new Kernel();
const orchestrator = new Orchestrator({ maxConcurrentTasks: 10, defaultTimeout: 600000 });

// Initialize Model Adapter (config-driven)
// - MODEL_PROVIDER=gpt4all|ollama|openai
// - or MODEL_CHAIN=gpt4all,openai,gpt4all (etc)
const modelAdapter = ModelAdapterFactory.createFromEnv();

// Create all agents with model adapter
const webDevAgentInstance = new WebDevAgent(modelAdapter);
const researchAgentInstance = new ResearchAgent(modelAdapter);
const systemAgentInstance = new SystemAgent(modelAdapter);

// Register all kernel-based agents (for orchestration)
const kernelAgents = [webDevAgentInstance, researchAgentInstance, systemAgentInstance];
kernelAgents.forEach((agent) => {
  const agentObj = agent.getAgent();
  kernel.registerAgent(agentObj);
  orchestrator.registerAgent(agentObj);
  
  // Register with scheduler
  kernelScheduler.registerAgent(agentObj.id, agent.getAgentId());
  
  // Emit event
  eventBus.emit('agent.registered', 'system', agentObj.id, { name: agentObj.name }).catch(console.error);
});

// Register default tools once (tools are accessed via ctx in plugins)
registerDefaultTools();

// Discover and register plugin agents from ./plugins/*/agent.ts
try {
  const plugins = loadAllPluginAgents();
  for (const p of plugins) {
    const pluginKernelAgent = pluginDefinitionToKernelAgent(p.definition, {
      env: {
        model: 'local',
        mode: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
        systemMode,
      },
      timeoutMs: 60000,
    });

    kernel.registerAgent(pluginKernelAgent);
    orchestrator.registerAgent(pluginKernelAgent);
    kernelScheduler.registerAgent(pluginKernelAgent.id, pluginKernelAgent.name);

    // Expose in UI agent list (after agents[] is declared below)
    if (!pluginAgentsForUi.some((a) => a.id === pluginKernelAgent.id)) {
      pluginAgentsForUi.push({ id: pluginKernelAgent.id, name: pluginKernelAgent.name });
    }

    eventBus
      .emit('agent.registered', 'system', pluginKernelAgent.id, { name: pluginKernelAgent.name, kind: 'plugin' })
      .catch(console.error);
  }

  if (plugins.length > 0) {
    console.log(`✓ Registered ${plugins.length} plugin agent(s) from ./plugins`);
  }
} catch (err) {
  console.error('Plugin agent discovery failed:', err);
}

console.log('✓ All agents registered with kernel, orchestrator, and scheduler');
kernel.startAgent(webDevAgentInstance.getAgentId());

type TaskStatus = "queued" | "in_progress" | "completed" | "failed" | "cancelled";
type AgentState = "READY" | "BUSY" | "IDLE";

type GenerationMode = 'creative' | 'deterministic';

interface GenerationConfig {
  mode: GenerationMode;
  temperature?: number;
  maxTokens?: number;
  seed?: number;
}

interface Task {
  id: string;
  agent: string;
  status: TaskStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  progress: number;
  input: string;
  output?: string;
  error?: string;
  progress_messages: Array<{ ts: number; message: string }>;
  generation?: GenerationConfig;
  systemMode?: SystemMode;
}

function normalizeGenerationConfig(raw: any): GenerationConfig {
  const mode: GenerationMode = raw?.mode === 'deterministic' ? 'deterministic' : 'creative';

  const temperatureRaw = typeof raw?.temperature === 'number' ? raw.temperature : undefined;
  const temperature = temperatureRaw == null ? undefined : Math.max(0, Math.min(2, temperatureRaw));

  const maxTokensRaw = typeof raw?.maxTokens === 'number' ? raw.maxTokens : undefined;
  const maxTokens = maxTokensRaw == null ? undefined : Math.max(1, Math.floor(maxTokensRaw));

  const seedRaw = typeof raw?.seed === 'number' ? raw.seed : undefined;
  const seed = seedRaw == null ? undefined : Math.floor(seedRaw);

  // Deterministic mode: best-effort on GPT4All (temperature=0)
  if (mode === 'deterministic') {
    return { mode, temperature: 0, maxTokens, seed };
  }

  return { mode, temperature, maxTokens, seed };
}

type EnvelopeStatus = "completed" | "in_progress" | "failed";

interface TaskEnvelope {
  status: EnvelopeStatus;
  result?: string;
  next_step?: string;
  reason?: string;
  agent: string;
  task: Task;
}

interface AgentInfo {
  id: string;
  name: string;
  status: AgentState;
  currentTaskId?: string;
  lastUpdated: number;
  type?: 'system' | 'plugin' | 'ui';
  model?: string;
  tags?: string[];
  permissions?: any;
  metadata?: Record<string, any>;
}

interface LogEntry {
  ts: number;
  level: "info" | "success" | "error";
  message: string;
}

const agents: AgentInfo[] = [
  { id: "web-dev-agent", name: "Web Dev Agent", status: "READY", lastUpdated: Date.now() },
  { id: "research-agent", name: "Research Agent", status: "READY", lastUpdated: Date.now() },
  { id: "system-agent", name: "System Agent", status: "READY", lastUpdated: Date.now() }
];
const activeAgentCounts = new Map<string, number>();

function markAgentBusy(agentId: string, taskId: string) {
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return;
  const next = (activeAgentCounts.get(agentId) || 0) + 1;
  activeAgentCounts.set(agentId, next);
  agent.status = "BUSY";
  agent.currentTaskId = taskId;
  agent.lastUpdated = Date.now();
  kernelScheduler.markBusy(agentId, taskId);
}

function markAgentIdle(agentId: string) {
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return;
  const current = activeAgentCounts.get(agentId) || 0;
  const next = Math.max(0, current - 1);
  activeAgentCounts.set(agentId, next);
  if (next === 0) {
    agent.status = "READY";
    agent.currentTaskId = undefined;
    agent.lastUpdated = Date.now();
    kernelScheduler.markIdle(agentId);
  }
}

type FailureAction = 'continue' | 'stop';
type PlannerMode = 'rule' | 'none';
type MultiAgentMode = 'auto' | 'force';

interface MultiAgentFailurePolicy {
  defaultAction?: FailureAction;
  perNode?: Record<string, FailureAction>;
  retries?: number;
}

interface MultiAgentGraphSpec {
  nodes: Array<{
    id: string;
    agentId: string;
    dependsOn?: string[];
    objective?: string;
    role?: string;
    allowFailure?: boolean;
    retries?: number;
  }>;
}

interface MultiAgentConfig {
  enabled: boolean;
  planner: PlannerMode;
  mode: MultiAgentMode;
  graph?: MultiAgentGraphSpec;
  failurePolicy: MultiAgentFailurePolicy;
  nodeTimeoutMs: number;
}

type WorkflowNodeStatus = 'pending' | 'running' | 'succeeded' | 'failed';

interface WorkflowStateNode {
  id: string;
  agentId: string;
  dependsOn: string[];
  status: WorkflowNodeStatus;
  role?: string;
}

interface WorkflowState {
  nodes: WorkflowStateNode[];
}

const workflowStateByTaskId = new Map<string, WorkflowState>();
const workflowDefinitionByTaskId = new Map<string, any>();

function normalizeMultiAgentConfig(raw: any): MultiAgentConfig {
  if (raw === true) {
    return {
      enabled: true,
      planner: 'rule',
      mode: 'force',
      failurePolicy: { defaultAction: 'continue', retries: 0 },
      nodeTimeoutMs: 600000,
    };
  }

  if (!raw || raw === false) {
    return {
      enabled: false,
      planner: 'none',
      mode: 'force',
      failurePolicy: { defaultAction: 'stop', retries: 0 },
      nodeTimeoutMs: 600000,
    };
  }

  const planner = raw.planner === 'none' ? 'none' : 'rule';
  const mode: MultiAgentMode = raw.mode === 'auto' ? 'auto' : 'force';
  const failurePolicy: MultiAgentFailurePolicy = {
    defaultAction: raw.failurePolicy?.defaultAction === 'continue' ? 'continue' : 'stop',
    perNode: typeof raw.failurePolicy?.perNode === 'object' ? raw.failurePolicy.perNode : undefined,
    retries: typeof raw.failurePolicy?.retries === 'number' ? Math.max(0, Math.floor(raw.failurePolicy.retries)) : 0,
  };

  const nodeTimeoutMs =
    typeof raw.nodeTimeoutMs === 'number' && Number.isFinite(raw.nodeTimeoutMs) && raw.nodeTimeoutMs > 0
      ? Math.floor(raw.nodeTimeoutMs)
      : 600000;

  const graph = raw.graph && Array.isArray(raw.graph.nodes) ? (raw.graph as MultiAgentGraphSpec) : undefined;

  return {
    enabled: raw.enabled !== false,
    planner,
    mode,
    graph,
    failurePolicy,
    nodeTimeoutMs,
  };
}

function inferMultiAgentIntent(input: string) {
  const wantsResearch = /(research|analy|summar|investig|benchmark|compare)/i.test(input);
  const wantsBuild = /(build|implement|code|create|develop|ui|frontend|backend|api|design)/i.test(input);
  const wantsReview = /(review|audit|security|test|validate|check|verify)/i.test(input);
  return { wantsResearch, wantsBuild, wantsReview };
}

function resolveMultiAgentDecision(input: string, config: MultiAgentConfig): boolean {
  if (!config.enabled) return false;
  if (config.mode === 'force') return true;

  const { wantsResearch, wantsBuild, wantsReview } = inferMultiAgentIntent(input);
  const intents = [wantsResearch, wantsBuild, wantsReview].filter(Boolean).length;

  // Only use multi-agent when the task clearly spans multiple intents.
  return intents >= 2;
}

function resolveFailureAction(nodeId: string, policy: MultiAgentFailurePolicy): FailureAction {
  const override = policy.perNode?.[nodeId];
  if (override === 'continue' || override === 'stop') return override;
  return policy.defaultAction === 'continue' ? 'continue' : 'stop';
}

function appendFinalNodeIfNeeded(
  nodes: MultiAgentGraphSpec['nodes'],
  policy: MultiAgentFailurePolicy,
  finalAgentId?: string
): MultiAgentGraphSpec['nodes'] {
  if (!finalAgentId || finalAgentId.trim().length === 0) return nodes;

  const hasFinal = nodes.some((node) => node.id === 'final' || node.role === 'final');
  if (hasFinal) return nodes;

  const dependsOn = nodes.map((node) => node.id);
  return [
    ...nodes,
    {
      id: 'final',
      agentId: finalAgentId,
      dependsOn,
      objective: 'final',
      role: 'final',
      allowFailure: false,
      retries: typeof policy.retries === 'number' ? policy.retries : 0,
    },
  ];
}

function buildGraphFromSpec(
  spec: MultiAgentGraphSpec,
  baseInput: Record<string, any>,
  policy: MultiAgentFailurePolicy,
  finalAgentId?: string,
  nodeTimeoutMs?: number
): TaskGraph {
  const nodes = appendFinalNodeIfNeeded(spec.nodes, policy, finalAgentId);

  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      dependsOn: node.dependsOn || [],
      allowFailure: node.allowFailure ?? (resolveFailureAction(node.id, policy) === 'continue'),
      task: {
        id: `${node.id}-task`,
        type: 'atomic',
        name: node.id,
        agentId: node.agentId,
        retries: typeof node.retries === 'number' ? node.retries : policy.retries,
        timeout: typeof nodeTimeoutMs === 'number' ? nodeTimeoutMs : undefined,
        input: {
          ...baseInput,
          objective: node.objective || node.id,
          ...(node.role ? { role: node.role } : {}),
        },
      },
    })),
  };
}

function buildRuleGraph(
  input: string,
  baseInput: Record<string, any>,
  policy: MultiAgentFailurePolicy,
  finalAgentId?: string,
  nodeTimeoutMs?: number
): TaskGraph {
  const { wantsResearch, wantsBuild, wantsReview } = inferMultiAgentIntent(input);

  const nodes: MultiAgentGraphSpec['nodes'] = [];

  if (wantsResearch) {
    nodes.push({ id: 'research', agentId: 'research-agent', objective: 'research' });
  }
  if (wantsBuild || nodes.length === 0) {
    nodes.push({ id: 'build', agentId: 'web-dev-agent', objective: 'build' });
  }
  if (wantsReview) {
    nodes.push({ id: 'review', agentId: 'system-agent', objective: 'review' });
  }

  const hasResearch = nodes.some((n) => n.id === 'research');
  const hasBuild = nodes.some((n) => n.id === 'build');

  const finalNodes = nodes.map((node, index) => {
    if (node.id === 'review') {
      const deps = nodes
        .filter((n) => n.id !== 'review')
        .map((n) => n.id);
      return { ...node, dependsOn: deps };
    }

    // Run research + build in parallel when both exist.
    if (hasResearch && hasBuild) {
      return { ...node, dependsOn: [] };
    }

    return { ...node, dependsOn: index > 0 ? [nodes[index - 1].id] : [] };
  });

  return buildGraphFromSpec({ nodes: finalNodes }, baseInput, policy, finalAgentId, nodeTimeoutMs);
}

function getPlannedAgentsForMultiAgent(
  input: string,
  config: MultiAgentConfig,
  finalAgentId?: string
): string[] {
  const planned: string[] = [];

  if (config.graph?.nodes && config.graph.nodes.length > 0) {
    for (const node of config.graph.nodes) {
      if (typeof node.agentId === 'string' && node.agentId.length > 0) {
        planned.push(node.agentId);
      }
    }
  } else {
    const { wantsResearch, wantsBuild, wantsReview } = inferMultiAgentIntent(input);
    if (wantsResearch) planned.push('research-agent');
    if (wantsBuild || planned.length === 0) planned.push('web-dev-agent');
    if (wantsReview) planned.push('system-agent');
  }

  if (finalAgentId && finalAgentId.trim().length > 0) {
    planned.push(finalAgentId);
  }

  return Array.from(new Set(planned));
}

function extractMultiAgentOutput(raw: any): { text: string; failures: Array<{ taskId: string; error: string }> } {
  if (!raw || typeof raw !== 'object') {
    return { text: typeof raw === 'string' ? raw : JSON.stringify(raw ?? ''), failures: [] };
  }

  const outputs = (raw as any).outputs || {};
  const failures = Array.isArray((raw as any).failures) ? (raw as any).failures : [];

  const pick = (id: string) => {
    const payload = outputs[id];
    if (payload == null) return '';
    const normalized = normalizeAgentExecutionOutput(payload);
    return normalized.displayText || '';
  };

  let text = pick('final');
  if (!text) {
    for (const key of Object.keys(outputs)) {
      const payload = outputs[key];
      if (payload && typeof payload === 'object' && payload.success === false) continue;
      const candidate = normalizeAgentExecutionOutput(payload).displayText || '';
      if (candidate) text = candidate;
    }
  }

  if (!text) {
    text = normalizeAgentExecutionOutput(raw).displayText;
  }

  return { text, failures };
}

// Append discovered plugin agents to UI list
for (const p of pluginAgentsForUi) {
  if (!agents.some((a) => a.id === p.id)) {
    agents.push({ id: p.id, name: p.name, status: 'READY', lastUpdated: Date.now() });
  }
}

const DATA_DIR = path.join(process.cwd(), '.data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

const tasks: Task[] = [];
const logs: LogEntry[] = [];

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Global error handlers - simple console logging
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]', error);
});

// Load persisted data
function loadPersistedData() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const taskData = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
      tasks.push(
        ...taskData.map((t: any) => ({
          ...t,
          progress_messages: t.progress_messages || []
        }))
      );
    }
    if (fs.existsSync(LOGS_FILE)) {
      const logData = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
      logs.push(...logData);
    }
  } catch (err) {
    console.error('Error loading persisted data:', err);
  }
}

// Save data to files
function saveData() {
  try {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error('Error saving data:', err);
  }
}

loadPersistedData();

function normalizeStaleTasksOnStartup() {
  const now = Date.now();
  let changed = 0;

  for (const task of tasks) {
    if (task.status === 'queued' || task.status === 'in_progress') {
      task.status = 'failed';
      task.error = task.error || 'Task failed after server restart';
      task.endedAt = task.endedAt || now;
      task.durationMs = task.durationMs || (task.startedAt ? task.endedAt - task.startedAt : undefined);
      task.progress = Math.max(task.progress || 0, 100);
      task.progress_messages = task.progress_messages || [];
      task.progress_messages.push({ ts: now, message: 'Marked failed after server restart' });
      changed += 1;
    }
  }

  if (changed > 0) {
    logs.push({ ts: now, level: 'info', message: `Recovered ${changed} stale task(s) after restart` });
    saveData();
  }

  activeAgentCounts.clear();
  for (const agent of agents) {
    agent.status = 'READY';
    agent.currentTaskId = undefined;
    agent.lastUpdated = now;
    kernelScheduler.markIdle(agent.id);
  }
}

normalizeStaleTasksOnStartup();

function formatStepLabel(step: string) {
  if (!step) return '';
  if (step.startsWith('graph.node.')) return step.replace('graph.node.', 'Graph: ');
  if (step.startsWith('orchestrator.')) return step.replace('orchestrator.', 'Orchestrator: ');
  if (step.startsWith('agent.runtime.')) return step.replace('agent.runtime.', 'Agent Runtime: ');
  if (step.startsWith('result.')) return step.replace('result.', 'Result Store: ');
  return step;
}

function registerTerminalTaskLogging() {
  const serverLogPath = path.join(process.cwd(), 'server.log');
  const appendServerLog = (line: string) => {
    try {
      fs.appendFileSync(serverLogPath, `${line}\n`);
    } catch {
      // ignore log write failures
    }
  };

  const logEvent = (label: string, event: { taskId: string; agentId: string; data?: any }) => {
    const agent = event.agentId || 'unknown-agent';
    const step = typeof event.data?.step === 'string' ? ` | ${formatStepLabel(event.data.step)}` : '';
    const line = `[${event.taskId}] ${label} (${agent})${step}`;
    console.log(line);
    appendServerLog(line);
  };

  eventBus.on('task.queued', (event) => logEvent('Queued', event));
  eventBus.on('task.started', (event) => logEvent('Started', event));
  eventBus.on('task.step', (event) => logEvent('Step', event));
  eventBus.on('task.completed', (event) => logEvent('Completed', event));
  eventBus.on('task.failed', (event) => logEvent('Failed', event));
  eventBus.on('task.cancelled', (event) => logEvent('Cancelled', event));
}

registerTerminalTaskLogging();

function addLog(level: LogEntry["level"], message: string) {
  logs.push({ ts: Date.now(), level, message });
  if (logs.length > 500) logs.shift();
  saveData();
}

function logLayer(taskId: string, message: string) {
  const line = `[${taskId}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(process.cwd(), 'server.log'), `${line}\n`);
  } catch {
    // ignore log write failures
  }
}

function pickAgent(preferredAgentId?: string): AgentInfo {
  if (preferredAgentId) {
    const byId = agents.find((a) => a.id === preferredAgentId);
    if (byId) return byId;
  }
  const ready = agents.find((a) => a.status === "READY");
  if (ready) return ready;
  const idle = agents.find((a) => !a.currentTaskId);
  return idle || agents[agents.length - 1];
}

function inferAgentType(input: string): 'web-dev' | 'research' | 'system' {
  const text = input.toLowerCase();

  const researchKeywords = [
    'research', 'resarch', 'find sources', 'summarize', 'compare', 'analysis', 'explain',
    'overview', 'report', 'investigate', 'reference', 'data', 'study', 'market', 'hiring',
    'employment', 'labor', 'economy'
  ];

  const systemKeywords = ['policy', 'system prompt', 'orchestrator', 'kernel'];

  if (researchKeywords.some((k) => text.includes(k))) return 'research';
  if (systemKeywords.some((k) => text.includes(k))) return 'system';
  return 'web-dev';
}

function emitProgress(taskId: string, message: string) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.progress_messages.push({ ts: Date.now(), message });
  addLog("info", `[${taskId}] ${message}`);
  saveData();
  publishTaskSnapshot(taskId);
}

type SSEClient = {
  res: express.Response;
  heartbeat: NodeJS.Timeout;
};

const sseClientsByTaskId = new Map<string, Set<SSEClient>>();

function buildTaskStatusPayload(task: Task) {
  return {
    task_id: task.id,
    status: task.status,
    progress: task.progress,
    agent: task.agent,
    input: task.input,
    generation: task.generation,
    messages: task.progress_messages.slice(-20),
    result: task.output,
    reason: task.error,
    startedAt: task.startedAt,
    durationMs: task.durationMs,
  };
}

function mapUiStatusToDetailsStatus(status: TaskStatus): 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' {
  if (status === 'in_progress') return 'running';
  return status;
}

function deriveCurrentStep(taskId: string): string | null {
  const history = eventBus.getTaskHistory(taskId);
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.type === 'task.step' && e.data && typeof e.data.step === 'string') return e.data.step;
    if (e.type === 'tool.called' && e.data && typeof e.data.toolName === 'string') return `tool:${e.data.toolName}`;
  }

  const task = tasks.find((t) => t.id === taskId);
  if (task && task.progress_messages.length > 0) {
    return task.progress_messages[task.progress_messages.length - 1].message;
  }

  return null;
}

function buildTaskLogs(taskId: string) {
  const history = eventBus.getTaskHistory(taskId);
  return history.slice(-200).map((e) => {
    let message: string = e.type;
    if (e.type === 'task.step' && e.data && typeof e.data.step === 'string') message = e.data.step;
    if (e.type === 'tool.called' && e.data && typeof e.data.toolName === 'string') message = `tool.called:${e.data.toolName}`;
    if (e.type === 'tool.completed' && e.data && typeof e.data.toolName === 'string') message = `tool.completed:${e.data.toolName}`;
    if (e.type === 'task.failed' && e.data && typeof e.data.error === 'string') message = `failed:${e.data.error}`;
    if (e.type === 'task.cancelled') message = 'cancelled';
    return {
      ts: e.timestamp,
      type: e.type,
      agentId: e.agentId,
      message,
      data: e.data,
    };
  });
}

function tryParseJson(raw: unknown): any | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function renderAgentResultToText(result: any): string {
  if (!result || typeof result !== 'object') return String(result ?? '');

  const type = (result as any).type;
  if (type === 'text' && typeof (result as any).content === 'string') return (result as any).content;
  if (type === 'error' && typeof (result as any).reason === 'string') return (result as any).reason;
  if (type === 'json') {
    const content = (result as any).content;
    try {
      return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }
  if (type === 'code' && Array.isArray((result as any).files)) {
    const files = (result as any).files as Array<{ path?: string; content?: string }>;
    return files
      .map((f) => {
        const p = typeof f.path === 'string' ? f.path : 'file';
        const c = typeof f.content === 'string' ? f.content : '';
        return `// ${p}\n${c}`;
      })
      .join('\n\n');
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function normalizeAgentExecutionOutput(rawOutput: unknown): {
  ok: boolean;
  displayText: string;
  rawOutput: string;
  agentResult?: any;
  agentId?: string;
  errorMessage?: string;
} {
  const rawText = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput ?? '');
  const parsed = tryParseJson(rawOutput);

  // New deterministic envelope: { ok, agent, result: AgentResult }
  if (parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean' && 'result' in parsed) {
    const agentResult = (parsed as any).result;
    const ok = Boolean((parsed as any).ok);
    const agentId = typeof (parsed as any).agent === 'string' ? (parsed as any).agent : undefined;
    const displayText = renderAgentResultToText(agentResult);
    const errorMessage =
      !ok
        ? typeof (agentResult as any)?.reason === 'string'
          ? (agentResult as any).reason
          : typeof (parsed as any).reason === 'string'
            ? (parsed as any).reason
            : 'Agent returned ok:false'
        : undefined;

    return { ok, displayText, rawOutput: rawText, agentResult, agentId, errorMessage };
  }

  // Legacy-ish envelope: { success, error, output/data }
  if (parsed && typeof parsed === 'object' && typeof (parsed as any).success === 'boolean') {
    const ok = Boolean((parsed as any).success);
    const errorMessage = !ok && typeof (parsed as any).error === 'string' ? (parsed as any).error : undefined;
    const payload = (parsed as any).output ?? (parsed as any).data ?? (parsed as any).result ?? parsed;
    const displayText = typeof payload === 'string' ? payload : renderAgentResultToText(payload);
    return { ok, displayText, rawOutput: rawText, agentResult: payload, errorMessage };
  }

  // Unknown: treat as plain text success
  return {
    ok: true,
    displayText: typeof rawOutput === 'string' ? rawOutput : renderAgentResultToText(rawOutput),
    rawOutput: rawText,
  };
}

function sseWrite(res: express.Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function publishTaskSnapshot(taskId: string) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const clients = sseClientsByTaskId.get(taskId);
  if (!clients || clients.size === 0) return;

  const payload = buildTaskStatusPayload(task);
  for (const client of clients) {
    try {
      sseWrite(client.res, 'task', payload);
    } catch {
      // ignore write errors; connection cleanup happens on close
    }
  }
}

function getMetrics() {
  const runningTasks = tasks.filter((t) => t.status === "in_progress").length;
  const completed = tasks.filter((t) => t.status === "completed");
  const failed = tasks.filter((t) => t.status === "failed").length;
  const totalDone = completed.length + failed;
  const avgResponseTime = completed.length
    ? Math.round(
        completed.reduce((sum, t) => sum + (t.durationMs || 0), 0) /
          completed.length
      )
    : 0;
  const tasksToday = tasks.filter(
    (t) => Date.now() - t.startedAt < 24 * 60 * 60 * 1000
  ).length;
  const successRate = totalDone ? Math.round((completed.length / totalDone) * 100) : 100;

  return {
    activeAgents: agents.length,
    runningTasks,
    avgResponseTime,
    successRate,
    tasksToday,
    completed: completed.length,
    failed
  };
}

function clearCompletedTasks() {
  const keep = tasks.filter((t) => t.status === "in_progress" || t.status === "queued");
  tasks.length = 0;
  tasks.push(...keep);
  saveData();
}

function clearLogs() {
  logs.length = 0;
  saveData();
}

function toEnvelope(task: Task): TaskEnvelope {
  if (task.status === "completed") {
    return {
      status: "completed",
      result: task.output || "",
      agent: task.agent,
      task
    };
  }
  if (task.status === "failed") {
    return {
      status: "failed",
      reason: task.error || "Unknown error",
      agent: task.agent,
      task
    };
  }
  return {
    status: "in_progress",
    result: `Task ${task.status} (progress ${task.progress || 0}%)`,
    next_step: "processing",
    agent: task.agent,
    task
  };
}

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(renderMinimalUI());
});

app.get("/api", (_req, res) => {
  res.json({
    ok: true,
    name: "Agent Core API",
    endpoints: [
      "GET /api/status",
      "GET /api/agents",
      "GET /api/tasks",
      "GET /api/task/:id",
      "GET /api/task/:id/status",
      "GET /api/logs",
      "POST /task",
      "POST /api/tasks/clear",
      "POST /api/logs/clear"
    ]
  });
});

app.get("/agents", (_req, res) => {
  res.json(agents);
});

app.get("/tasks", (_req, res) => {
  const sorted = [...tasks].sort((a, b) => b.startedAt - a.startedAt);
  res.json(sorted.map(toEnvelope));
});

app.get("/logs", (_req, res) => {
  res.json(logs.slice(-200));
});

// Frontend pages removed: no /submit route

app.get("/api/status", (_req, res) => {
  try {
    res.json(getMetrics());
  } catch (err) {
    console.error("Error in /api/status:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/agents", (_req, res) => {
  const kernelAgents = new Map(kernel.listAgents().map((a) => [a.id, a] as const));

  const enriched = agents.map((uiAgent) => {
    const ka = kernelAgents.get(uiAgent.id);
    const kind = (ka?.metadata?.kind as any) || (uiAgent.id.startsWith('plugin:') ? 'plugin' : 'system');

    return {
      ...uiAgent,
      type: kind,
      model: ka?.model,
      tags: ka?.tags,
      permissions: ka?.metadata?.permissions ?? ka?.metadata?.permissions,
      metadata: ka?.metadata,
    };
  });

  res.json(enriched);
});

// Hot-reload plugin agents (Phase 2): manual trigger.
app.post('/api/plugins/reload', (_req, res) => {
  try {
    const result = reloadAllPluginAgents({
      kernel,
      orchestrator,
      scheduler: kernelScheduler as any,
      uiAgents: agents as any,
      services: {
        env: {
          model: 'local',
          mode: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
          systemMode,
        },
        timeoutMs: 60000,
      },
    });

    addLog('info', `Plugin reload: loaded=${result.loaded.length} removed=${result.removed.length} errors=${result.errors.length}`);
    res.json({ ok: true, result, agents });
  } catch (err) {
    console.error('Plugin reload failed:', err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// Hot-reload plugin agents (Phase 2): file watcher.
// Enable explicitly (including in production) via PLUGIN_HOT_RELOAD=1
const pluginHotReloadEnabled =
  process.env.PLUGIN_HOT_RELOAD === '1' ||
  String(process.env.PLUGIN_HOT_RELOAD || '').toLowerCase() === 'true';

if (pluginHotReloadEnabled) {
  try {
    startPluginWatcher({
      pluginsRoot: path.join(process.cwd(), 'plugins'),
      debounceMs: 200,
      onChange: (reason) => {
        try {
          const result = reloadAllPluginAgents({
            kernel,
            orchestrator,
            scheduler: kernelScheduler as any,
            uiAgents: agents as any,
            services: {
              env: {
                model: 'local',
                mode: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
                systemMode,
              },
              timeoutMs: 60000,
            },
          });
          addLog('info', `Plugin watcher reload (${reason.event}): loaded=${result.loaded.length} removed=${result.removed.length} errors=${result.errors.length}`);
        } catch (err) {
          console.error('Plugin watcher reload failed:', err);
        }
      },
    });
    console.log('✓ Plugin hot-reload watcher enabled (PLUGIN_HOT_RELOAD=1)');
  } catch (err) {
    console.error('Plugin watcher failed to start:', err);
  }
}

// Scheduler status endpoint for UI load bars
app.get("/api/scheduler/status", (_req, res) => {
  try {
    const status = kernelScheduler.getStatus();
    res.json(status);
  } catch (err) {
    console.error("Error in /api/scheduler/status:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/tasks", (_req, res) => {
  const sorted = [...tasks].sort((a, b) => b.startedAt - a.startedAt);
  res.json(sorted.map(toEnvelope));
});

app.get("/api/task/:id", (req, res) => {
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ status: "failed", reason: "Task not found", action_required: "Verify task id" });
  }
  res.json(toEnvelope(task));
});
// Frontend task timeline page removed

app.get("/api/task/:id/status", (req, res) => {
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  res.json(buildTaskStatusPayload(task));
});

// Stream task status/log updates via SSE (preferred by frontend; polling still supported)
app.get("/api/task/:id/stream", (req, res) => {
  const taskId = req.params.id;
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const maybeFlush = (res as unknown as { flushHeaders?: () => void }).flushHeaders;
  if (typeof maybeFlush === 'function') maybeFlush.call(res);

  const client: SSEClient = {
    res,
    heartbeat: setInterval(() => {
      try {
        res.write(`:keep-alive ${Date.now()}\n\n`);
      } catch {
        // ignore
      }
    }, 15000),
  };

  if (!sseClientsByTaskId.has(taskId)) {
    sseClientsByTaskId.set(taskId, new Set());
  }
  sseClientsByTaskId.get(taskId)!.add(client);

  // Send initial snapshot immediately
  sseWrite(res, 'task', buildTaskStatusPayload(task));

  req.on('close', () => {
    clearInterval(client.heartbeat);
    const set = sseClientsByTaskId.get(taskId);
    if (set) {
      set.delete(client);
      if (set.size === 0) sseClientsByTaskId.delete(taskId);
    }
  });
});

// Cancel a running task
app.post("/api/task/:id/cancel", (req, res) => {
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  if (["completed", "failed", "cancelled"].includes(task.status)) {
    return res.status(400).json({ error: "Task already finished" });
  }
  task.status = "cancelled";
  task.endedAt = Date.now();
  task.durationMs = task.endedAt - task.startedAt;
  task.error = "Task was cancelled by user";

  // Hard cancellation: abort the underlying execution (all tasks)
  const aborted = abortTask(task.id, "Task was cancelled by user");
  if (aborted) {
    addLog("info", `[${task.id}] AbortSignal triggered for running execution`);
  }

  // Backwards compatibility for older plugin-only cancellation wiring
  abortPluginTask(task.id);
  
  // Update TaskStore with cancelled status
  taskStore.updateTask(task.id, {
    status: 'cancelled',
    error: 'Task was cancelled by user',
    completedAt: task.endedAt,
    durationMs: task.durationMs
  });

  // Emit cancellation event (Phase 3 observability)
  const agentId = taskStore.getTask(task.id)?.agent || 'unknown';
  eventBus.emit('task.cancelled', task.id, agentId, { reason: 'Task was cancelled by user' }).catch(() => {});
  
  emitProgress(task.id, "Task cancelled by user");
  addLog("info", `[${task.id}] Task cancelled by user`);
  saveData();
  publishTaskSnapshot(task.id);
  res.json({ ok: true, status: "cancelled" });
});

// Task Details (Phase 3)
app.get('/api/task/:id/details', (req, res) => {
  const taskId = req.params.id;

  const task = tasks.find((t) => t.id === taskId);
  const record = taskStore.getTask(taskId);
  if (!task && !record) {
    return res.status(404).json({ ok: false, error: 'Task not found' });
  }

  const status = task ? mapUiStatusToDetailsStatus(task.status) : (record!.status === 'in_progress' ? 'running' : record!.status);

  const signal = getTaskAbortSignal(taskId);
  const cancelable = Boolean(hasTaskAbortController(taskId) && signal && !signal.aborted && (status === 'queued' || status === 'running'));

  const startedAt = task?.startedAt ?? record!.startedAt;
  const endedAt = task?.endedAt ?? record!.completedAt;
  const durationMs = task?.durationMs ?? record!.durationMs ?? (endedAt ? endedAt - startedAt : Date.now() - startedAt);

  res.json({
    ok: true,
    taskId,
    status,
    agentId: record?.agent,
    agentName: task?.agent,
    startedAt,
    endedAt,
    durationMs,
    progress: task?.progress ?? record?.progress ?? null,
    currentStep: deriveCurrentStep(taskId),
    cancelable,
    logs: buildTaskLogs(taskId),
    workflow: workflowDefinitionByTaskId.get(taskId) ?? null,
    graph: workflowStateByTaskId.get(taskId) ?? null,
  });
});

// Scheduler Transparency
app.get("/scheduler", async (_req, res) => {
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Scheduler Status</title>
      <style>
        :root {
          --bg: #0b0e14;
          --panel: #11151c;
          --border: #1a1f2b;
          --text: #e6e8eb;
          --muted: #9aa1ae;
          --accent: #4da3ff;
          --success: #32d074;
        }
        * { box-sizing: border-box; }
        body { margin:0; font-family: 'Inter','Segoe UI',system-ui,sans-serif; background: var(--bg); color: var(--text); }
        .wrap { max-width: 800px; margin: 40px auto; padding: 0 16px; }
        h1 { margin: 0 0 12px; font-size: 22px; }
        .back { display: inline-block; padding: 8px 12px; margin-bottom: 24px; background: var(--border); border-radius: 6px; text-decoration: none; color: var(--accent); font-size: 12px; }
        .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 36px rgba(0,0,0,0.35); }
        .section { padding: 20px; border-bottom: 1px solid var(--border); }
        .section:last-child { border-bottom: none; }
        .stat { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .stat:last-child { margin-bottom: 0; }
        .stat-label { color: var(--muted); font-size: 13px; }
        .stat-value { font-weight: 600; font-size: 18px; }
        .agents-list { display: flex; flex-direction: column; gap: 12px; }
        .agent-item { background: var(--bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border); }
        .agent-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .agent-name { font-weight: 600; }
        .load-bar { width: 100%; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
        .load-fill { height: 100%; background: var(--accent); }
        .agent-info { display: flex; gap: 20px; font-size: 12px; color: var(--muted); margin-top: 8px; }
        .refresh { color: var(--muted); font-size: 12px; margin-top: 12px; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <a href="/monitor" class="back">← Back to Monitor</a>
        <h1>Scheduler Status</h1>
        
        <div class="card">
          <div class="section">
            <div class="stat">
              <span class="stat-label">Queue Length</span>
              <span class="stat-value" id="queueLen">—</span>
            </div>
            <div class="stat">
              <span class="stat-label">Avg Agent Load</span>
              <span class="stat-value" id="avgLoad">—</span>
            </div>
          </div>

          <div class="section">
            <h3 style="margin:0 0 12px;font-size:14px;">Agent Loads</h3>
            <div class="agents-list" id="agents"></div>
          </div>

          <div class="refresh" id="lastRefresh"></div>
        </div>
      </div>

      <script>
        async function refresh() {
          try {
            const res = await fetch('/api/scheduler/status');
            if (!res.ok) return;
            const data = await res.json();
            
            document.getElementById('queueLen').textContent = data.queuedTasks || 0;
            document.getElementById('avgLoad').textContent = (data.avgLoad || 0) + '%';

            const agents = (data.agents || []).sort((a,b) => b.loadScore - a.loadScore);
            document.getElementById('agents').innerHTML = agents.map(a => 
              '<div class="agent-item">' +
                '<div class="agent-header">' +
                  '<span class="agent-name">' + (a.agentName || a.agentId || '?') + '</span>' +
                  '<span style="font-weight:600;">' + (a.loadScore || 0) + '%</span>' +
                '</div>' +
                '<div class="load-bar"><div class="load-fill" style="width:' + Math.min(a.loadScore || 0, 100) + '%"></div></div>' +
                '<div class="agent-info">' +
                  '<span>Tasks: ' + (a.tasksRunning || 0) + '</span>' +
                  '<span>Idle: ' + (a.idleTime || 0) + 'ms</span>' +
                '</div>' +
              '</div>'
            ).join('');

            document.getElementById('lastRefresh').textContent = '↻ Updated ' + new Date().toLocaleTimeString();
          } catch (e) {
            console.error('Refresh error:', e);
          }
        }

        refresh();
        setInterval(refresh, 1000);
      </script>
    </body>
  </html>`;
  res.send(html);
});

// 9 Layers Architecture Visualization
app.get("/layers", (_req, res) => {
  const layers = [
    { name: 'API Gateway', status: 'completed', desc: 'Express routes & endpoints' },
    { name: 'Task Registry', status: 'completed', desc: 'Tasks array & storage' },
    { name: 'Orchestrator', status: 'completed', desc: 'Workflow execution' },
    { name: 'Scheduler', status: 'active', desc: 'Task scheduling' },
    { name: 'Agent Runtime', status: 'pending', desc: 'Agent execution context' },
    { name: 'Model Adapter', status: 'pending', desc: 'LLM integration' },
    { name: 'Result Store', status: 'pending', desc: 'Persistent results' },
    { name: 'Event Stream', status: 'pending', desc: 'Real-time events' },
    { name: 'Cleanup', status: 'pending', desc: 'Resource cleanup' }
  ];

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>9-Layer Architecture</title>
      <style>
        :root {
          --bg: #0b0e14;
          --panel: #11151c;
          --border: #1a1f2b;
          --text: #e6e8eb;
          --muted: #9aa1ae;
          --accent: #4da3ff;
          --success: #32d074;
          --active: #ffa500;
        }
        * { box-sizing: border-box; }
        body { margin:0; font-family: 'Inter','Segoe UI',system-ui,sans-serif; background: var(--bg); color: var(--text); }
        .wrap { max-width: 600px; margin: 60px auto; padding: 0 16px; }
        h1 { margin: 0 0 12px; font-size: 28px; font-weight: 600; }
        .subtitle { color: var(--muted); font-size: 14px; margin-bottom: 40px; }
        .layer { display: flex; align-items: center; gap: 16px; padding: 16px; margin-bottom: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; }
        .dot { width: 16px; height: 16px; border-radius: 999px; flex-shrink: 0; }
        .dot.completed { background: var(--success); box-shadow: 0 0 0 8px rgba(50,208,116,0.15); }
        .dot.active { background: var(--active); box-shadow: 0 0 0 8px rgba(255,165,0,0.15); animation: pulse 1.5s infinite; }
        .dot.pending { background: var(--muted); box-shadow: 0 0 0 8px rgba(154,161,174,0.15); }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        .info { flex: 1; }
        .name { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
        .desc { font-size: 12px; color: var(--muted); }
        .status-text { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .back { display: inline-block; padding: 8px 12px; margin-bottom: 32px; background: var(--border); border-radius: 6px; text-decoration: none; color: var(--accent); font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <a href="/" class="back">← Home</a>
        <h1>9-Layer Architecture</h1>
        <p class="subtitle">Agent Core's unique differentiator: layered system design</p>
        
        <div id="layers"></div>
      </div>

      <script>
        const layers = ${JSON.stringify(layers)};
        const container = document.getElementById('layers');
        container.innerHTML = layers.map(l => 
          '<div class="layer">' +
            '<div class="dot ' + l.status + '"></div>' +
            '<div class="info">' +
              '<div class="name">' + l.name + '</div>' +
              '<div class="desc">' + l.desc + '</div>' +
            '</div>' +
            '<div class="status-text">' + l.status + '</div>' +
          '</div>'
        ).join('');
      </script>
    </body>
  </html>`;
  res.send(html);
});

// Single Task Console
app.get("/task/:id", (req, res) => {
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Task Console</title>
      <style>
        :root {
          --bg: #0b0e14;
          --panel: #11151c;
          --border: #1a1f2b;
          --text: #e6e8eb;
          --muted: #9aa1ae;
          --accent: #4da3ff;
          --success: #32d074;
          --error: #ff5d5d;
        }
        * { box-sizing: border-box; }
        body { margin:0; font-family: 'Inter','Segoe UI',system-ui,sans-serif; background: var(--bg); color: var(--text); }
        .wrap { max-width: 900px; margin: 40px auto; padding: 0 16px; }
        h1 { margin: 0 0 8px; font-size: 22px; }
        .meta { color: var(--muted); font-size: 12px; margin-bottom: 24px; }
        .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 36px rgba(0,0,0,0.35); }
        .section { padding: 20px; border-bottom: 1px solid var(--border); }
        .section:last-child { border-bottom: none; }
        .timeline { padding: 0; }
        .msg { padding: 12px 20px; border-bottom: 1px solid var(--border); font-size: 13px; line-height: 1.5; }
        .msg:last-child { border-bottom: none; }
        .msg.error { background: rgba(255, 93, 93, 0.05); color: #ff9999; }
        .msg.info { color: var(--muted); }
        .result { padding: 20px; margin-top: 20px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; }
        .result.success { border-color: rgba(50, 208, 116, 0.3); background: rgba(50, 208, 116, 0.05); }
        .result.error { border-color: rgba(255, 93, 93, 0.3); background: rgba(255, 93, 93, 0.05); }
        .result h3 { margin: 0 0 12px; color: var(--success); }
        .result.error h3 { color: var(--error); }
        .result code { background: var(--bg); padding: 12px; border-radius: 6px; display: block; overflow-x: auto; font-size: 12px; line-height: 1.5; }
        .progress { color: var(--accent); }
        .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--accent); display: inline-block; margin-right: 8px; animation: pulse 1s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .back { display: inline-block; padding: 8px 12px; margin-bottom: 16px; background: var(--border); border-radius: 6px; text-decoration: none; color: var(--accent); font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <a href="/monitor" class="back">← Back to Monitor</a>
        <h1 id="title">Task</h1>
        <div class="meta" id="meta">Loading...</div>
        
        <div class="card">
          <div class="section timeline" id="timeline"></div>
        </div>

        <div id="resultContainer"></div>
      </div>

      <script>
        const taskId = '${req.params.id}';
        const pollInterval = 600; // ms
        let pollTimer;

        function fmtSecs(ms) {
          if (!ms && ms !== 0) return '—';
          return (ms/1000).toFixed(1) + 's';
        }

        async function poll() {
          try {
            const res = await fetch('/api/task/' + taskId + '/status');
            if (!res.ok) {
              document.getElementById('meta').textContent = 'Task not found';
              return;
            }
            const t = await res.json();
            
            // Update title and meta
            document.getElementById('title').textContent = 'Task: ' + (t.agent || '?');
            const elapsed = t.durationMs ? fmtSecs(t.durationMs) : (t.startedAt ? fmtSecs(Date.now() - t.startedAt) : '—');
            document.getElementById('meta').textContent = 'ID: ' + t.task_id + ' | Status: ' + t.status + ' | Elapsed: ' + elapsed;

            // Render timeline
            const timeline = document.getElementById('timeline');
            if (t.messages && t.messages.length) {
              timeline.innerHTML = t.messages.map(m => 
                '<div class="msg ' + (m.includes('error') || m.includes('Error') ? 'error' : 'info') + '">' + escapeHtml(m) + '</div>'
              ).join('');
            } else if (t.status === 'in_progress') {
              timeline.innerHTML = '<div class="msg info"><span class="dot"></span>Task running...</div>';
            }

            // Render result if complete
            if (t.status === 'completed' && t.result) {
              renderResult('success', 'Task Completed', t.result);
              clearInterval(pollTimer);
            } else if (t.status === 'failed' && t.reason) {
              renderResult('error', 'Task Failed', t.reason);
              clearInterval(pollTimer);
            }
          } catch (e) {
            console.error('Poll error:', e);
          }
        }

        function renderResult(type, title, content) {
          const container = document.getElementById('resultContainer');
          const isJson = content.trim().startsWith('{') || content.trim().startsWith('[');
          const formatted = isJson ? JSON.stringify(JSON.parse(content), null, 2) : content;
          container.innerHTML = 
            '<div class="result ' + type + '">' +
              '<h3>' + title + '</h3>' +
              '<code>' + escapeHtml(formatted) + '</code>' +
            '</div>';
        }

        function escapeHtml(s) {
          return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        }

        poll();
        pollTimer = setInterval(poll, pollInterval);
      </script>
    </body>
  </html>`;
  res.send(html);
});

// Task Monitor UI (Task Dashboard)
app.get("/monitor", (_req, res) => {
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Task Monitor</title>
      <style>
        :root {
          --bg: #0b0e14;
          --panel: #11151c;
          --border: #1a1f2b;
          --text: #e6e8eb;
          --muted: #9aa1ae;
          --accent: #4da3ff;
          --success: #32d074;
          --error: #ff5d5d;
        }
        * { box-sizing: border-box; }
        body { margin:0; font-family: 'Inter','Segoe UI',system-ui,sans-serif; background: var(--bg); color: var(--text); }
        .wrap { max-width: 960px; margin: 40px auto; padding: 0 16px; }
        h1 { margin: 0 0 16px; font-size: 22px; letter-spacing: 0.01em; }
        .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 36px rgba(0,0,0,0.35); }
        .table { width: 100%; border-collapse: collapse; }
        .table th, .table td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--border); font-size: 13px; }
        .table th { color: var(--muted); font-weight: 600; }
        .status { display:inline-flex; align-items:center; gap:6px; font-weight:600; }
        .dot { width:10px; height:10px; border-radius:999px; background: var(--muted); }
        .dot.running { background: var(--accent); box-shadow: 0 0 0 6px rgba(77,163,255,0.18); }
        .dot.completed { background: var(--success); box-shadow: 0 0 0 6px rgba(50,208,116,0.18); }
        .dot.failed { background: var(--error); box-shadow: 0 0 0 6px rgba(255,93,93,0.18); }
        .muted { color: var(--muted); font-size: 12px; }
        .mono { font-family: 'JetBrains Mono','SFMono-Regular',Menlo,monospace; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
          <h1>Task Monitor</h1>
          <div style="display:flex;gap:8px;">
            <a href="/scheduler" style="color:var(--accent);text-decoration:none;font-size:12px;padding:8px 12px;background:var(--border);border-radius:6px;">Scheduler</a>
            <a href="/layers" style="color:var(--accent);text-decoration:none;font-size:12px;padding:8px 12px;background:var(--border);border-radius:6px;">Architecture</a>
          </div>
        </div>
        <div class="card">
          <table class="table" id="taskTable">
            <thead>
              <tr>
                <th>ID</th>
                <th>Agent</th>
                <th>Status</th>
                <th>Elapsed</th>
              </tr>
            </thead>
            <tbody id="taskRows"></tbody>
          </table>
        </div>
      </div>

      <script>
        const pollInterval = 800; // ms
        let taskIndex = [];

        function statusDot(status){
          const cls = status === 'completed' ? 'completed' : (status === 'failed' ? 'failed' : 'running');
          return '<span class="status"><span class="dot ' + cls + '"></span>' + status + '</span>';
        }

        function fmtSecs(ms){
          if (!ms && ms !== 0) return '—';
          return (ms/1000).toFixed(1)+'s';
        }

        async function fetchTasks() {
          try {
            const res = await fetch('/api/tasks');
            if (!res.ok) return;
            const data = await res.json();
            taskIndex = data.map(t => (t.task ? t.task.id : t.id)).slice(0, 20);
          } catch (e) { /* ignore */ }
        }

        async function fetchStatuses() {
          const rows = [];
          for (const id of taskIndex) {
            try {
              const res = await fetch('/api/task/' + id + '/status');
              if (!res.ok) continue;
              const t = await res.json();
              const elapsed = t.durationMs ? t.durationMs : (t.startedAt ? Date.now() - t.startedAt : null);
              rows.push({ id: t.task_id, agent: t.agent || '—', status: t.status || '—', elapsed });
            } catch (e) { /* ignore */ }
          }
          render(rows);
        }

        function render(list){
          const tbody = document.getElementById('taskRows');
          if (!tbody) return;
          if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="muted">No tasks yet</td></tr>';
            return;
          }
          tbody.innerHTML = list.map(t =>
            '<tr>' +
              '<td class="mono"><a href="/task/' + t.id + '" style="color: var(--accent); text-decoration: none;">' + t.id + '</a></td>' +
              '<td>' + t.agent + '</td>' +
              '<td>' + statusDot(t.status) + '</td>' +
              '<td>' + fmtSecs(t.elapsed) + '</td>' +
            '</tr>'
          ).join('');
        }

        async function tick(){
          if (!taskIndex.length) await fetchTasks();
          await fetchStatuses();
        }

        tick();
        setInterval(tick, pollInterval);
      </script>
    </body>
  </html>`;
  res.send(html);
});

app.get("/api/logs", (_req, res) => {
  res.json(logs.slice(-200));
});

app.post("/api/tasks/clear", (_req, res) => {
  clearCompletedTasks();
  res.json({ ok: true, remaining: tasks.length });
});

app.post("/api/logs/clear", (_req, res) => {
  clearLogs();
  res.json({ ok: true });
});

app.post("/task", async (req, res) => {
  // Check if taskId is provided (for retry/different agent)
  const providedTaskId = req.body?.taskId;
  const id = providedTaskId || uuidv4(); // Reuse task ID if provided
  const manuallySelected = req.body?.manuallySelected === true; // Check if manually selected
  
  try {
    // If the client is attempting to reuse a taskId, ensure the old run is not still active.
    // This prevents two executions from racing under the same id (and avoids inheriting
    // cancellation state mid-flight).
    if (providedTaskId) {
      const existing = tasks.find((t) => t.id === id);
      if (existing && !['completed', 'failed', 'cancelled'].includes(existing.status)) {
        return res.status(409).json({
          status: 'failed',
          reason: 'Task is still running. Cancel/stop it before retrying with the same taskId.',
        });
      }
    }

    // Layer 1: API Gateway (Express) - Input validation
    const inputRaw = typeof req.body?.input === "string" ? req.body.input : "";
    const input = inputRaw.trim();
    const conversationId = req.body?.conversationId || null; // Get conversationId if provided
    const generation = normalizeGenerationConfig(req.body?.generation);
    const reqSystemMode: SystemMode = req.body?.systemMode || systemMode;
    const multiAgentConfig = normalizeMultiAgentConfig(req.body?.multiAgent);
    const isMultiAgent = resolveMultiAgentDecision(input, multiAgentConfig);
    
    if (!input) {
      return res.status(400).json({ 
        status: "failed", 
        reason: "input is required", 
        action_required: "Provide a task description" 
      });
    }

    // Layer 2: Task Registry & Validation
    logLayer(id, 'Starting 9-layer architecture pipeline...');
    logLayer(id, 'Layer 1/9: API Gateway ✓');
    logLayer(id, 'Layer 2/9: Task Registry - Validating input...');
    
    // Use agent from request body if provided, otherwise infer from input
    const requestedAgent = req.body?.agent;
    let agentType: 'web-dev' | 'research' | 'system';
    
    if (requestedAgent) {
      // Map agent ID to agent type
      if (requestedAgent === 'web-dev-agent' || requestedAgent === 'web-dev') {
        agentType = 'web-dev';
        console.log(`[${id}] Using requested agent: web-dev`);
      } else if (requestedAgent === 'research-agent' || requestedAgent === 'research') {
        agentType = 'research';
        console.log(`[${id}] Using requested agent: research`);
      } else if (requestedAgent === 'system-agent' || requestedAgent === 'system') {
        agentType = 'system';
        console.log(`[${id}] Using requested agent: system`);
      } else if (agents.some((a) => a.id === requestedAgent)) {
        // Plugin (or other registered) agent id; keep agentType valid for registry validation
        agentType = 'web-dev';
        console.log(`[${id}] Using requested agent id: ${requestedAgent}`);
      } else {
        // Unknown agent, fall back to inference
        console.log(`[${id}] Unknown agent '${requestedAgent}', falling back to inference`);
        agentType = inferAgentType(input);
      }
    } else {
      // No agent specified, infer from input
      agentType = inferAgentType(input);
    }

    const validationResult = taskRegistry.validate({
      input,
      agentType,
      priority: 'normal',
      timeout: 600000,
      metadata: { clientIP: req.ip, timestamp: Date.now(), systemMode: reqSystemMode },
    });

    if (!validationResult.valid) {
      return res.status(400).json({
        status: "failed",
        reason: validationResult.errors.join(', '),
      });
    }

    // Register task with registry
    const registeredTask = taskRegistry.register(id, {
      input,
      agentType,
      priority: 'normal',
      timeout: 600000,
      // systemMode is not part of TaskRequest, only store in TaskRecord
    });

    logLayer(id, `Layer 2/9: Task Registry - Registered as ${registeredTask.id} ✓`);

    // Layer 3: Orchestrator context preparation
    logLayer(id, 'Layer 3/9: Orchestrator - Preparing workflow...');

    // Layer 4: Kernel Scheduler - Agent selection
    if (isMultiAgent) {
      const modeLabel = multiAgentConfig.mode === 'auto' ? 'auto' : 'forced';
      logLayer(id, `Layer 4/9: Kernel Scheduler - Multi-agent workflow (${modeLabel})`);
    } else {
      logLayer(id, 'Layer 4/9: Kernel Scheduler - Selecting agent...');
    }
    const schedulingDecision =
      manuallySelected && typeof requestedAgent === 'string' && agents.some((a) => a.id === requestedAgent)
        ? {
            agentId: requestedAgent,
            agentName: pickAgent(requestedAgent).name,
            scheduledAt: Date.now(),
            estimatedWaitMs: 0,
          }
        : kernelScheduler.selectAgent(agentType);
    
    if (!schedulingDecision) {
      return res.status(503).json({
        status: "failed",
        reason: "No agents available for scheduling",
      });
    }
    
    const selectedAgentId = schedulingDecision.agentId;
    if (!isMultiAgent) {
      logLayer(id, `Layer 4/9: Kernel Scheduler - Selected ${selectedAgentId} ✓`);
    }

    const multiAgentReason = multiAgentConfig.enabled
      ? multiAgentConfig.mode === 'auto'
        ? `Auto workflow: ${isMultiAgent ? 'multi-agent' : 'single-agent'} (planner: ${multiAgentConfig.planner}; defaultAction: ${multiAgentConfig.failurePolicy.defaultAction || 'stop'}; retries: ${multiAgentConfig.failurePolicy.retries || 0})`
        : `Multi-agent workflow (planner: ${multiAgentConfig.planner}; defaultAction: ${multiAgentConfig.failurePolicy.defaultAction || 'stop'}; retries: ${multiAgentConfig.failurePolicy.retries || 0})`
      : undefined;

    // Create or update persistent task record with agent decision tracking
    let registeredTaskId = id; // Default to current ID
    if (providedTaskId) {
      // Update existing task with new agent/status and input (for edited retries)
      taskStore.updateTask(id, {
        input,
        agent: selectedAgentId,
        status: 'pending',
        generation,
        agentSelectionReason: manuallySelected
          ? `Manually selected: ${selectedAgentId}`
          : (multiAgentReason || `Retry with: ${selectedAgentId}. Inferred type: ${agentType}.`),
        availableAgents: agents.map(a => a.id),
        manuallySelected: manuallySelected,
        systemMode: reqSystemMode,
        multiAgentEnabled: isMultiAgent,
      });
      console.log(`[${id}] Task updated in TaskStore (retry/different agent)${manuallySelected ? ' - manually selected' : ''}`);
    } else {
      // Create new task
      const persistentTask = taskStore.createTask(input, {
        id, // Use same ID for consistency
        agent: selectedAgentId,
        generation,
        agentSelectionReason: manuallySelected 
          ? `Manually selected: ${selectedAgentId}`
          : (multiAgentReason || `Inferred type: ${agentType}. Keywords matched: ${agentType} patterns.`),
        availableAgents: agents.map(a => a.id),
        tags: [agentType, 'api-request'],
        conversationId: conversationId || id, // Use provided conversationId or task ID as conversation ID
        manuallySelected: manuallySelected,
        systemMode: reqSystemMode,
        multiAgentEnabled: isMultiAgent,
      });
      registeredTaskId = persistentTask.id;
      console.log(`[${id}] Task persisted to TaskStore${conversationId ? ` with conversationId: ${conversationId}` : ''}${manuallySelected ? ' - manually selected' : ''}`);
    }

    if (isMultiAgent) {
      const plannedAgents = getPlannedAgentsForMultiAgent(input, multiAgentConfig, selectedAgentId);
      if (plannedAgents.length > 1) {
        taskStore.updateTask(id, { involvedAgents: plannedAgents });
      }
    }

    // Mark agent as busy in scheduler
    kernelScheduler.markBusy(selectedAgentId, id);
    await eventBus.emit('agent.busy', id, selectedAgentId, { taskId: id });

    // Emit queued event
    await eventBus.emit('task.queued', id, selectedAgentId);

    // Layer 5: Create or update task entry for UI
    const agent = pickAgent(selectedAgentId);
    const now = Date.now();
    
    // Check if task already exists (retry/different agent case)
    const existingTaskIndex = tasks.findIndex(t => t.id === id);
    
    const task: Task = {
      id,
      agent: agent.name,
      status: "queued",
      startedAt: now,
      progress: 0,
      input,
      progress_messages: [],
      generation,
      systemMode: reqSystemMode,
    };

    if (existingTaskIndex !== -1) {
      // Update existing task
      tasks[existingTaskIndex] = task;
      console.log(`[${id}] Updated existing task in memory (retry/different agent)`);
    } else {
      // Add new task
      tasks.push(task);
    }
    
    emitProgress(id, "Task queued");
    saveData();
    addLog("info", `Task ${id} queued for ${agent.name} (agent: ${selectedAgentId})`);

    // Create cancellation handle immediately (so /cancel can hard-abort even before execution begins)
    getOrCreateTaskAbortController(id);

    agent.status = "BUSY";
    agent.currentTaskId = id;
    agent.lastUpdated = now;

    // Respond immediately (202 Accepted) with queued status for UI and orchestration chaining
    res.status(202).json({ taskId: id, status: "queued" });

    // Execute asynchronously through full 9-layer pipeline
    setImmediate(() => {
      executeTaskAsync(id, task, agent, input, selectedAgentId, registeredTaskId, agentType, multiAgentConfig).catch((err) => {
        console.error(`[${id}] Uncaught error in executeTaskAsync:`, err);
        fs.appendFileSync(path.join(DATA_DIR, 'error.log'), `[${id}] Uncaught: ${err}\n`);
      });
    });

  } catch (err) {
    console.error(`[${id}] Error in POST /task:`, err);
    fs.appendFileSync(path.join(DATA_DIR, 'error.log'), `Error in POST /task: ${err}\n`);
    res.status(500).json({ status: "failed", reason: String(err) });
  }
});

// Execute task through full 9-layer architecture pipeline
async function executeTaskAsync(
  id: string, 
  task: Task, 
  agent: AgentInfo, 
  input: string,
  selectedAgentId: string,
  registeredTaskId: string,
  agentType: string,
  multiAgentConfig: MultiAgentConfig
) {
  const abortController = getOrCreateTaskAbortController(id);

  const multiAgent = resolveMultiAgentDecision(input, multiAgentConfig);
  let graph: TaskGraph | undefined;

  try {
    // Check if task was cancelled before starting
    if (task.status === "cancelled") {
      console.log(`[${id}] Task was cancelled before execution started`);
      abortController.abort("Task was cancelled before execution started");
      return;
    }

    task.status = "in_progress";
    task.progress = 10;
    emitProgress(id, "Task started");
    saveData();

    // Layer 5: Agent Runtime - Execution context
    logLayer(id, 'Layer 5/9: Agent Runtime - Starting execution...');
    await eventBus.emit('task.started', id, selectedAgentId, { input });
    await eventBus.emit('task.step', id, selectedAgentId, { step: 'agent.runtime.start' });

    task.progress = 25;
    saveData();
    publishTaskSnapshot(id);

    // Layer 6: Model Adapter - LLM abstraction
    logLayer(id, `Layer 6/9: Model Adapter - Calling ${selectedAgentId}...`);
    await eventBus.emit('task.step', id, selectedAgentId, { step: 'orchestrator.create-workflow' });

    // Conversation context: use TaskStore conversationId to pull prior completed turns.
    const storeRecord = taskStore.getTask(id);
    const conversationId = storeRecord?.conversationId;
    const historyTurns = conversationId
      ? taskStore
          .query({ sortBy: 'startedAt', sortOrder: 'asc' })
          .filter((t) => t.conversationId === conversationId)
          .filter((t) => t.id !== id)
          .filter((t) => t.status === 'completed')
          .filter((t) => typeof t.output === 'string' && t.output.trim().length > 0)
          .slice(-4)
          .map((t) => ({
            input: t.input,
            output: (t.output || '').slice(0, 2000),
            taskId: t.id,
            agentId: t.agent,
            ts: t.startedAt,
          }))
      : [];

    const baseInput = {
      taskId: id,
      conversationId,
      history: historyTurns,
      query: input,
      generation: task.generation,
      ...(task.systemMode ? { systemMode: task.systemMode } : {}),
    };

    graph = multiAgent
      ? (multiAgentConfig.graph
          ? buildGraphFromSpec(
              multiAgentConfig.graph,
              baseInput,
              multiAgentConfig.failurePolicy,
              selectedAgentId,
              multiAgentConfig.nodeTimeoutMs
            )
          : buildRuleGraph(
              input,
              baseInput,
              multiAgentConfig.failurePolicy,
              selectedAgentId,
              multiAgentConfig.nodeTimeoutMs
            ))
      : undefined;

    const plannedAgents = graph?.nodes
      ? Array.from(
          new Set(
            graph.nodes
              .map((node) => node.task.agentId)
              .filter((agentId): agentId is string => typeof agentId === 'string' && agentId.length > 0)
          )
        )
      : undefined;

    if (plannedAgents && plannedAgents.length > 1) {
      taskStore.updateTask(id, { involvedAgents: plannedAgents });
    }

    if (graph) {
      const stateNodes = graph.nodes.map((node) => ({
        id: node.id,
        agentId: node.task.agentId || 'unknown',
        dependsOn: node.dependsOn || [],
        status: 'pending' as WorkflowNodeStatus,
        role: (node.task.input as any)?.role,
      }));
      workflowStateByTaskId.set(id, { nodes: stateNodes });
    }

    // Create orchestration task (atomic or multi-agent graph)
    const orchestrationTask: OrchestrationTask = multiAgent
      ? {
          id: `orchestration-${id}`,
          type: "graph",
          name: `Multi-agent workflow: ${input.substring(0, 50)}`,
          description: input,
          agentId: selectedAgentId,
          input: baseInput,
          graph,
          timeout: 600000,
        }
      : {
          id: `orchestration-${id}`,
          type: "atomic",
          name: `Execute: ${input.substring(0, 50)}`,
          description: input,
          agentId: selectedAgentId,
          input: baseInput,
          timeout: 600000,
        };

    // Layer 3: Orchestrator - explicit workflow definition
    const workflowDefinition = multiAgent
      ? {
          taskId: id,
          intent: 'multi-agent',
          graph: (graph?.nodes || []).map((node) => ({
            id: node.id,
            agent: node.task.agentId,
            dependsOn: node.dependsOn || [],
          })),
          constraints: {
            maxTime: 60,
            model: 'local',
            allowPartialFailures: true,
            nodeTimeoutMs: multiAgentConfig.nodeTimeoutMs,
          },
        }
      : {
          taskId: id,
          intent: agentType || 'generic',
          steps: [
            { agent: agentType || selectedAgentId, action: agentType === 'research' ? 'research' : 'execute' }
          ],
          constraints: {
            maxTime: 60,
            model: 'local'
          }
        };

    workflowDefinitionByTaskId.set(id, workflowDefinition);

    const workflowId = `workflow-${id}`;
    logLayer(id, `Layer 3/9: Orchestrator - Creating workflow ${workflowId} with definition: ${JSON.stringify(workflowDefinition)}...`);
    
    orchestrator.createWorkflow(
      workflowId,
      `Task ${id}`,
      orchestrationTask,
      { userInput: input, workflowDefinition, ...(task.systemMode ? { systemMode: task.systemMode } : {}) }
    );

    logLayer(id, 'Layer 3/9: Orchestrator - Executing workflow...');
    await eventBus.emit('task.step', id, selectedAgentId, { step: 'orchestrator.execute-workflow' });

    // Check if task was cancelled before workflow execution
    const currentTask = tasks.find(t => t.id === id);
    if (currentTask && currentTask.status === "cancelled") {
      console.log(`[${id}] Task cancelled, aborting workflow execution`);
      return;
    }

    const execution = await orchestrator.executeWorkflow(workflowId, {
      signal: abortController.signal,
      onNodeEvent: multiAgent
        ? (evt) => {
            const state = workflowStateByTaskId.get(id);
            if (state) {
              const node = state.nodes.find((n) => n.id === evt.nodeId);
              if (node) {
                node.status = evt.status;
                if (evt.status === 'running') {
                  markAgentBusy(node.agentId, id);
                } else if (evt.status === 'succeeded' || evt.status === 'failed') {
                  markAgentIdle(node.agentId);
                }
              }
            }

            eventBus
              .emit('task.step', id, selectedAgentId, {
                step: `graph.node.${evt.nodeId}.${evt.status}`,
                nodeId: evt.nodeId,
                status: evt.status,
              })
              .catch(() => {});
          }
        : undefined,
    });

    console.log(`[${id}] Workflow execution completed. Status: ${execution.status}`);

    // Check if task was cancelled during execution
    const taskAfterExecution = tasks.find(t => t.id === id);
    if (taskAfterExecution && taskAfterExecution.status === "cancelled") {
      console.log(`[${id}] Task was cancelled during execution, skipping result processing`);
      return;
    }

    // Extract + normalize output (Phase 3 deterministic AgentResult)
    const multiAgentPayload = multiAgent ? extractMultiAgentOutput(execution.result?.output) : null;
    const rawOutput = multiAgent
      ? multiAgentPayload?.text
      : (execution.result?.output ?? (execution.status === 'succeeded' ? 'Task completed successfully' : 'No output generated'));

    const normalized = normalizeAgentExecutionOutput(rawOutput);
    if (!normalized.ok) {
      throw new Error(normalized.errorMessage || 'Agent execution failed');
    }

    let output = normalized.displayText;
    if (multiAgentPayload && multiAgentPayload.failures.length > 0) {
      const failureLines = multiAgentPayload.failures
        .map((f) => `- ${f.taskId}: ${f.error}`)
        .join('\n');
      output = `${output}\n\nPartial failures:\n${failureLines}`;
    }

    task.progress = 75;
    saveData();
    publishTaskSnapshot(id);

    // Layer 7: Result Store - Persistent caching
    logLayer(id, 'Layer 7/9: Result Store - Caching result...');
    await eventBus.emit('task.step', id, selectedAgentId, { step: 'result.store' });
    const storedResult = resultStore.store(id, {
      agentId: selectedAgentId,
      content: output,
      model: 'gpt4all',
      executionTimeMs: task.durationMs || 0,
      metadata: { taskId: id, registeredTaskId },
    });
    logLayer(id, 'Layer 7/9: Result Store - Stored ✓');

    // Update registry
    taskRegistry.updateStatus(registeredTaskId, 'completed');

    task.output = output;
    task.status = "completed";
    task.progress = 90;
    task.endedAt = Date.now();
    task.durationMs = task.endedAt - task.startedAt;
    emitProgress(id, "Task completed");
    addLog("success", `Task ${id} completed by ${agent.name}`);
    saveData();

    const involvedAgents = multiAgent && graph?.nodes
      ? Array.from(
          new Set(
            graph.nodes
              .map((n) => n.task.agentId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0)
          )
        )
      : undefined;

    // Update persistent task record with completion
    taskStore.updateTask(id, {
      status: 'completed',
      output,
      rawOutput: normalized.rawOutput,
      agentResult: multiAgent ? execution.result?.output : normalized.agentResult,
      involvedAgents,
      messages: task.progress_messages.map(m => m.message),
      progress: 100,
    });

    task.progress = 100;
    saveData();
    publishTaskSnapshot(id);

    // Layer 8: Event Stream - Publish completion
    logLayer(id, 'Layer 8/9: Event Stream - Publishing completion event...');
    await eventBus.emit('task.completed', id, selectedAgentId, { 
      output, 
      durationMs: task.durationMs,
      model: 'gpt4all',
    });

    console.log(`[${id}] ✓ All 9 layers completed successfully`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${id}] Task execution error:`, err);

    // Check if task was cancelled - don't overwrite cancelled status
    const currentTask = tasks.find(t => t.id === id);
    if (currentTask && currentTask.status === 'cancelled') {
      console.log(`[${id}] Task was already cancelled, not overwriting status`);
      return; // Exit early, don't process as failure
    }

    task.status = "failed";
    task.progress = 100;
    task.endedAt = Date.now();
    task.durationMs = task.endedAt - task.startedAt;
    task.error = message;
    emitProgress(id, `Task failed: ${message}`);
    addLog("error", `Task ${id} failed: ${message}`);
    saveData();

    const failedInvolvedAgents = multiAgent && graph?.nodes
      ? Array.from(
          new Set(
            graph.nodes
              .map((n) => n.task.agentId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0)
          )
        )
      : undefined;

    // Update persistent task record with failure
    taskStore.updateTask(id, {
      status: 'failed',
      error: message,
      involvedAgents: failedInvolvedAgents,
      messages: task.progress_messages.map(m => m.message),
    });

    // Update registry with failure
    taskRegistry.updateStatus(registeredTaskId, 'failed');

    // Emit failure event
    try {
      await eventBus.emit('task.failed', id, selectedAgentId, { error: message });
    } catch (eventErr) {
      console.error(`[${id}] Error emitting failure event:`, eventErr);
    }
  } finally {
    cleanupTaskAbortController(id);

    // Layer 9: Response & Cleanup
    logLayer(id, 'Layer 9/9: Response & Cleanup - Finalizing...');
    
    agent.status = "READY";
    agent.currentTaskId = undefined;
    agent.lastUpdated = Date.now();
    
    // Mark agent idle in scheduler
    kernelScheduler.markIdle(selectedAgentId);
    try {
      await eventBus.emit('agent.idle', id, selectedAgentId);
    } catch (eventErr) {
      console.error(`[${id}] Error emitting idle event:`, eventErr);
    }
    
    saveData();
    
    console.log(`[${id}] ✓ Task finalization complete`);
  }
}

// ============================================
// TASK HISTORY & PERSISTENT MEMORY API
// ============================================

// Get task history with filters
app.get("/api/history", (req, res) => {
  try {
    const filters: any = {};
    
    if (req.query.status) filters.status = req.query.status;
    if (req.query.agent) filters.agent = req.query.agent;
    if (req.query.startDate) filters.startDate = Number(req.query.startDate);
    if (req.query.endDate) filters.endDate = Number(req.query.endDate);
    if (req.query.isRetry) filters.isRetry = req.query.isRetry === 'true';
    if (req.query.limit) filters.limit = Number(req.query.limit);
    if (req.query.offset) filters.offset = Number(req.query.offset);
    if (req.query.sortBy) filters.sortBy = req.query.sortBy;
    if (req.query.sortOrder) filters.sortOrder = req.query.sortOrder;
    
    const results = taskStore.query(filters);
    res.json({ tasks: results, count: results.length });
  } catch (error) {
    console.error('Error querying task history:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Get specific task with full details
app.get("/api/history/:taskId", (req, res) => {
  try {
    const task = taskStore.getTask(req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    console.error('Error getting task:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Get retry chain for a task
app.get("/api/history/:taskId/retries", (req, res) => {
  try {
    const chain = taskStore.getRetryChain(req.params.taskId);
    res.json({ tasks: chain, count: chain.length });
  } catch (error) {
    console.error('Error getting retry chain:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Create a retry for a failed task
app.post("/api/history/:taskId/retry", async (req, res) => {
  try {
    const originalTask = taskStore.getTask(req.params.taskId);
    if (!originalTask) {
      return res.status(404).json({ error: 'Original task not found' });
    }

    // Create retry task in persistent store
    const retryTask = taskStore.createRetry(req.params.taskId, req.body.input);
    if (!retryTask) {
      return res.status(400).json({ error: 'Failed to create retry' });
    }

    console.log(`Creating retry ${retryTask.id} for original task ${req.params.taskId}`);

    // Now submit the retry task through the normal pipeline
    // This will create a new task in the regular system
    const response = await fetch(`http://localhost:${PORT}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: retryTask.input,
        agent: originalTask.agent, // Use same agent
      }),
    });

    if (!response.ok) {
      return res.status(500).json({ error: 'Failed to submit retry task' });
    }

    const result = await response.json();
    
    // Update the retry task ID with the actual submitted task ID
    const rekeyed = taskStore.rekeyTask(retryTask.id, result.taskId);
    if (!rekeyed) {
      return res.status(500).json({ error: 'Failed to update retry task id' });
    }

    res.json({
      retryTaskId: result.taskId,
      originalTaskId: req.params.taskId,
      status: 'queued',
    });
  } catch (error) {
    console.error('Error creating retry:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Get statistics
app.get("/api/history/stats", (_req, res) => {
  try {
    const stats = taskStore.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Get per-agent stats (used by Explainability Panel)
app.get("/api/history/agent/:agentId/stats", (req, res) => {
  try {
    const agentId = String(req.params.agentId || '').trim();
    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }

    const tasks = taskStore.query({ agent: agentId });
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    const cancelled = tasks.filter(t => t.status === 'cancelled').length;
    const total = tasks.length;

    const denom = completed + failed;
    const successRate = denom > 0 ? completed / denom : 1;

    res.json({
      agentId,
      total,
      completed,
      failed,
      cancelled,
      successRate,
      successRatePercent: Math.round(successRate * 100),
    });
  } catch (error) {
    console.error('Error getting agent stats:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Agent Performance Metrics (Step 14)
app.get('/api/metrics/agents', (req, res) => {
  try {
    const windowHoursRaw = Number(req.query.windowHours);
    const windowHours = Number.isFinite(windowHoursRaw) && windowHoursRaw > 0 ? windowHoursRaw : 24;
    const windowMs = windowHours * 60 * 60 * 1000;
    const since = Date.now() - windowMs;

    const COST_PER_1K_TOKENS_USD = 0.001; // simulated cost
    const estimateTokens = (input: string, output: string) => Math.ceil(((input || '').length + (output || '').length) / 4);

    const topReasons = (failed: Array<{ failedLayer?: string; error?: string; errorCode?: string }>) => {
      const counts = new Map<string, number>();
      for (const t of failed) {
        const raw =
          (typeof t.failedLayer === 'string' && t.failedLayer.trim()) ||
          (typeof t.errorCode === 'string' && t.errorCode.trim()) ||
          (typeof t.error === 'string' && t.error.trim()) ||
          'Unknown error';
        const reason = raw.length > 90 ? raw.slice(0, 87) + '…' : raw;
        counts.set(reason, (counts.get(reason) || 0) + 1);
      }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => ({ reason, count }));
    };

    const agentIds = agents.map(a => a.id);

    const metrics = agentIds.map(agentId => {
      const agentInfo = agents.find(a => a.id === agentId);
      const recent = taskStore.query({ agent: agentId, startDate: since });

      const completed = recent.filter(t => t.status === 'completed');
      const failed = recent.filter(t => t.status === 'failed');
      const cancelled = recent.filter(t => t.status === 'cancelled');

      const denom = completed.length + failed.length;
      const successRate = denom > 0 ? completed.length / denom : 1;

      const durationSamples = recent
        .filter(t => (t.status === 'completed' || t.status === 'failed') && typeof t.durationMs === 'number')
        .map(t => t.durationMs as number);
      const avgDurationMs = durationSamples.length
        ? Math.round(durationSamples.reduce((sum, v) => sum + v, 0) / durationSamples.length)
        : 0;

      const tokenSamples = recent.map(t => estimateTokens(t.input || '', t.output || ''));
      const estTokens = tokenSamples.reduce((sum, v) => sum + v, 0);
      const estCostUsd = Number(((estTokens / 1000) * COST_PER_1K_TOKENS_USD).toFixed(6));

      return {
        agentId,
        agentName: agentInfo?.name || agentId,
        windowHours,
        total: recent.length,
        completed: completed.length,
        failed: failed.length,
        cancelled: cancelled.length,
        successRatePercent: Math.round(successRate * 100),
        avgExecutionTimeMs: avgDurationMs,
        failureReasons: topReasons(failed),
        cost: {
          currency: 'USD',
          estimated: true,
          costPer1kTokensUsd: COST_PER_1K_TOKENS_USD,
          estimatedTokens: estTokens,
          estimatedCostUsd: estCostUsd,
        },
        updatedAt: Date.now(),
      };
    });

    res.json({ windowHours, agents: metrics });
  } catch (error) {
    console.error('Error getting agent metrics:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Delete old tasks (cleanup)
app.delete("/api/history/cleanup", (req, res) => {
  try {
    const daysOld = Number(req.query.days) || 30;
    const deletedCount = taskStore.deleteOlderThan(daysOld);
    res.json({ deletedCount, daysOld });
  } catch (error) {
    console.error('Error cleaning up old tasks:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Delete all tasks (clear history)
app.delete("/api/history", (_req, res) => {
  try {
    const deletedCount = taskStore.clearAll();
    res.json({ deletedCount });
  } catch (error) {
    console.error('Error clearing history:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Delete a specific task or all tasks in a conversation
app.delete("/api/task/:id", (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the task to find its conversationId
    const task = taskStore.getTask(id);
    
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    
    // If task has a conversationId, delete all tasks in that conversation
    let deletedCount = 0;
    if (task.conversationId) {
      deletedCount = taskStore.deleteByConversationId(task.conversationId);
    } else {
      // No conversationId, just delete this single task
      const success = taskStore.deleteTask(id);
      deletedCount = success ? 1 : 0;
    }
    
    if (deletedCount > 0) {
      res.json({ success: true, deletedCount });
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: String(error) });
  }
});

app.listen(PORT, () => {
  addLog("info", `Server listening on http://localhost:${PORT}`);
  console.log(`Server listening on http://localhost:${PORT}`);
});

function renderBaseShell(title: string, body: string): string {
  return (
    "<!DOCTYPE html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="UTF-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
    `<title>${title}</title>` +
    "<style>" +
    "*{box-sizing:border-box;margin:0;padding:0}" +
    "body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f6f7fb;color:#0f172a}" +
    ".app{display:grid;grid-template-rows:1fr auto;min-height:100vh}" +
    ".topbar{display:none}" +
    ".brand{display:flex;align-items:center;gap:10px}" +
    ".brand .logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#1e3a8a,#2563eb)}" +
    ".nav{display:flex;gap:10px}" +
    ".nav a{text-decoration:none;color:#0f172a;padding:8px 10px;border-radius:8px}" +
    ".nav a:hover{background:#f3f4f6}" +
    ".status{display:flex;align-items:center;gap:8px}" +
    ".badge{display:inline-block;padding:4px 8px;border-radius:999px;font-size:12px;font-weight:600}" +
    ".busy{background:#fdecea;color:#b91c1c}" +
    ".ready{background:#ecfdf3;color:#15803d}" +
    ".idle{background:#fffbeb;color:#b45309}" +
    ".layout{display:grid;grid-template-columns:240px 1fr;gap:16px;padding:16px}" +
    ".sidebar{background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:12px;position:sticky;top:16px;height:fit-content}" +
    ".sidebar a{display:block;text-decoration:none;color:#0f172a;padding:10px;border-radius:8px}" +
    ".sidebar a:hover{background:#f3f4f6}" +
    ".canvas{min-height:70vh}" +
    ".card{background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px}" +
    ".muted{color:#6b7280;font-size:12px}" +
    "table{width:100%;border-collapse:collapse}" +
    "th,td{border-bottom:1px solid #e5e7eb;padding:10px;text-align:left}" +
    "th{background:#f9fafb;font-size:12px;color:#6b7280}" +
    ".progress{width:100%;height:6px;background:#e5e7eb;border-radius:4px;overflow:hidden}" +
    ".progress span{display:block;height:100%;background:#2563eb}" +
    ".activitybar{display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid #e5e7eb;background:#ffffff}" +
    /* Motion & states for timeline */
    ".step{display:flex;align-items:center;gap:10px;transition:all 280ms ease-in-out;padding:8px 10px;border-radius:10px}" +
    ".step.pending{opacity:0.5;transform:translateY(-2px)}" +
    ".step.active{opacity:1;background:#f8fafc;box-shadow:0 6px 18px rgba(0,0,0,0.06)}" +
    ".step.completed{opacity:1;background:#ffffff;border:1px solid #e5e7eb}" +
    "@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(37,99,235,0.4)}70%{box-shadow:0 0 0 12px rgba(37,99,235,0)}100%{box-shadow:0 0 0 0 rgba(37,99,235,0)}}" +
    ".dot{width:10px;height:10px;border-radius:50%;background:#2563eb}" +
    ".dot.pulsing{animation:pulse 1.6s ease-in-out infinite}" +
    "</style>" +
    "</head>" +
    "<body>" +
    '<div class="app">' +
    '<div class="layout">' +
    '<div class="sidebar">' +
    '<div class="muted" style="margin-bottom:6px;display:flex;align-items:center;gap:10px"><div class="logo" style="width:22px;height:22px"></div><div style="font-weight:700">Agent OS</div></div>' +
    '<a href="/">Home</a><a href="/tasks">Tasks</a><a href="/logs">Activity</a><a href="/agents">Advanced</a>' +
    '</div>' +
    '<div class="canvas">' + body + '</div>' +
    '</div>' +
    '<div class="activitybar"><span class="muted">Activity</span><span id="activeTasks" class="badge idle">0 running</span><span id="errorsCount" class="badge busy">0 errors</span></div>' +
    '</div>' +
    '<script>' +
    "async function _refreshTop(){try{const s=await fetch('/api/status');const status=await s.json();var at=document.getElementById('activeTasks');if(at)at.textContent=(status.runningTasks||0)+' running';var ec=document.getElementById('errorsCount');if(ec)ec.textContent=(status.failed||0)+' errors';}catch(e){}}setInterval(_refreshTop,3000);_refreshTop();" +
    '</script>' +
    "</body>" +
    "</html>"
  );
}

function renderOverviewPage(): string {
  const content = `
  <div class="card" style="min-height:60vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:linear-gradient(135deg,#fafcff,#ffffff)">
    <div style="font-size:24px;font-weight:700">What do you want to get done?</div>
    <div class="muted">The system will handle the rest.</div>
    <input id="homeInput" type="text" placeholder="Type and press Enter" style="margin-top:8px;width:60%;max-width:620px;padding:14px;border:1px solid #d1d5db;border-radius:12px;font-size:16px;background:#fff" />
  </div>
  <script>
    ${commonClientHelpers()}
    async function refreshTop(){
      try{
        const s=await fetch('/api/status');
        const status=await s.json();
        document.getElementById('activeTasks').textContent=(status.runningTasks||0)+' running';
        document.getElementById('errorsCount').textContent=(status.failed||0)+' errors';
      }catch(e){}
    }
    refreshTop();setInterval(refreshTop,3000);
    const homeInput=document.getElementById('homeInput');
    homeInput.addEventListener('keydown',async (e)=>{
      if(e.key==='Enter'){
        const val=homeInput.value.trim();
        if(!val) return;
        localStorage.setItem('pendingTaskInput', val);
        window.location.href='/submit';
      }
    });
  </script>
  `;
  return renderBaseShell("Home", content);
}

function renderAgentsPage(): string {
  const content =
    '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
    '<h3>Agents</h3>' +
    '<div class="muted">Live status</div>' +
    "</div>" +
    '<div id="agentsList"></div>' +
    "</div>" +
    '<script>' +
    commonClientHelpers() +
    "async function refresh(){const res=await fetch('/api/agents');const data=await res.json();renderAgents(data,'agentsList');}" +
    "refresh();setInterval(refresh,2000);" +
    "</script>";
  return renderBaseShell("Agents", content);
}

function renderTasksPage(): string {
  const content = `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3>Tasks</h3>
      <div style="display:flex;gap:8px">
        <input id="filterStatus" type="text" placeholder="Filter by status (all/completed/failed)" style="padding:6px;border:1px solid #e5e7eb;border-radius:8px;width:220px" />
        <button id="refreshBtn">Refresh</button>
        <button id="clearBtn" title="Clear completed/failed tasks">Clear History</button>
      </div>
    </div>
    <div id="tasksTable"></div>
  </div>
  <script>
    ${commonClientHelpers()}
    function buildTable(list){
      const el=document.getElementById('tasksTable');
      if(!el) return;
      el.innerHTML='<table><thead><tr><th>ID</th><th>Agent</th><th>Status</th><th>Progress</th><th>Duration</th><th>Input</th><th>Open</th></tr></thead><tbody>'+
        list.map(t=>{
          const cls=t.status==='in_progress'?'busy':(t.status==='completed'?'ready':'idle');
          const label=t.status.toUpperCase().replace('_',' ');
          const dur=t.durationMs?formatMs(t.durationMs):'—';
          const input=(t.input||'');
          const open='<a href="/task/'+t.id+'" style="color:#2563eb;text-decoration:none;font-weight:600">Open</a>';
          return '<tr><td>'+t.id+'</td><td>'+t.agent+'</td><td><span class=\'badge '+cls+'\'>'+label+'</span></td><td>'+(t.progress||0)+'%</td><td>'+dur+'</td><td>'+input.slice(0,80)+'</td><td>'+open+'</td></tr>';
        }).join('')+
        '</tbody></table>';
    }
    async function load(){
      const res=await fetch('/api/tasks');
      let data=await res.json();
      data=data.map(w=>{const base=w.task||{};return {...base,status:w.status,result:w.result,reason:w.reason,action_required:w.action_required};});
      const filter=document.getElementById('filterStatus').value.toLowerCase().trim();
      if(filter&&filter!=='all'){data=data.filter(t=>t.status===filter);} 
      buildTable(data);
    }
    document.getElementById('filterStatus').oninput=load;
    document.getElementById('refreshBtn').onclick=load;
    document.getElementById('clearBtn').onclick=async()=>{await fetch('/api/tasks/clear',{method:'POST'});load();};
    load();setInterval(load,3000);
  </script>
  `;
  return renderBaseShell("Tasks", content);
}

function renderLogsPage(): string {
  const content = `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3>Activity</h3>
      <button id="clearLogs">Clear</button>
    </div>
    <div id="activityLog"></div>
  </div>
  <script>
    ${commonClientHelpers()}
    async function load(){const res=await fetch('/api/logs');const data=await res.json();renderLogs(data,'activityLog');}
    document.getElementById('clearLogs').onclick=async()=>{await fetch('/api/logs/clear',{method:'POST'});load();};
    load();setInterval(load,3000);
  </script>
  `;
  return renderBaseShell("Activity", content);
}

function renderSubmitPage(): string {
  return renderMinimalUI();
}

function renderMinimalUI() {
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Agent OS v0.1</title>
    <style>
      :root {
        --bg: #0B0E14;
        --panel: #11151C;
        --panel-2: #0D1118;
        --border: #1A1F2B;
        --text: #E6E8EB;
        --muted: #9AA1AE;
        --accent: #4DA3FF;
        --error: #FF5D5D;
        --radius: 14px;
        --shadow: 0 20px 60px rgba(0,0,0,0.35);
      }
      * { box-sizing: border-box; }
      @keyframes gradientShift {
        0%, 100% { background-position: 0% 0%; }
        50% { background-position: 100% 0%; }
      }
      body { margin:0; background: radial-gradient(circle at 20% 20%, rgba(77,163,255,0.12), transparent 32%), radial-gradient(circle at 78% 0%, rgba(77,163,255,0.1), transparent 28%), var(--bg); background-size: 200% 100%; animation: gradientShift 12s ease-in-out infinite; color: var(--text); font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }
      .app { min-height: 100vh; display:grid; grid-template-rows: 56px 1fr 120px; }
      .topbar { display:flex; align-items:center; justify-content:space-between; padding: 0 20px; border-bottom: 1px solid var(--border); backdrop-filter: blur(10px); background: rgba(17,21,28,0.7); }
      .brand { display:flex; align-items:center; gap:10px; font-weight:600; font-size:15px; letter-spacing:0.01em; }
      .logo { width:28px; height:28px; border-radius:9px; background: linear-gradient(135deg, #4DA3FF, #6dd5ed); box-shadow: 0 8px 25px rgba(77,163,255,0.35); }
      .chips { display:flex; align-items:center; gap:10px; }
      .chip { padding: 8px 12px; border-radius: 12px; border:1px solid var(--border); background: rgba(255,255,255,0.03); color: var(--text); font-size: 12px; display:flex; align-items:center; gap:8px; }
      .dot { width:10px; height:10px; border-radius:999px; background:#4DA3FF; box-shadow: 0 0 0 6px rgba(77,163,255,0.18); }
      .dot.green { background:#32D074; box-shadow:0 0 0 6px rgba(50,208,116,0.18); }
      .dot.red { background:#FF5D5D; box-shadow:0 0 0 6px rgba(255,93,93,0.18); }
      .body { display:grid; grid-template-columns: 260px 1fr; }
      .sidebar { border-right:1px solid var(--border); background: rgba(0,0,0,0.1); padding: 18px; display:flex; flex-direction:column; gap:14px; }
      .sidebar h4 { margin:0; font-size:13px; letter-spacing:0.04em; text-transform:uppercase; color: var(--muted); }
      .agent-list { display:flex; flex-direction:column; gap:10px; }
      .agent-row { padding:12px; border-radius:12px; border:1px solid var(--border); background: linear-gradient(145deg, rgba(255,255,255,0.02), rgba(0,0,0,0.06)); display:flex; flex-direction:column; gap:6px; transition: border-color 160ms ease, box-shadow 180ms ease; }
      .agent-row.active { border-color: rgba(77,163,255,0.6); box-shadow: 0 10px 30px rgba(77,163,255,0.2); }
      .agent-title { display:flex; align-items:center; gap:8px; font-weight:600; font-size:14px; }
      .status { display:flex; align-items:center; gap:6px; font-size:12px; color: var(--muted); }
      .load-bar { height:3px; border-radius:999px; background: rgba(255,255,255,0.06); overflow:hidden; }
      .load-fill { height:100%; background: var(--accent); width:0%; transition: width 200ms ease; }
      .recent { margin-top: 6px; display:flex; flex-direction:column; gap:8px; }
      .recent-item { padding:10px 12px; border-radius:10px; border:1px solid var(--border); background: rgba(255,255,255,0.03); display:flex; justify-content:space-between; align-items:center; font-size:12px; cursor:pointer; gap:10px; min-width:0; }
      .recent-item:hover { border-color: rgba(77,163,255,0.5); }
      .recent-title { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .recent-right { display:flex; align-items:center; gap:8px; flex-shrink:0; }
      /* Add subtle space between the light and the status label */
      .recent-right .recent-status + .recent-status { margin-left:6px; }
      .status-pill { padding:4px 8px; border-radius:10px; border:1px solid var(--border); white-space:nowrap; }
      .workspace { padding: 22px; display:flex; flex-direction:column; gap:16px; }
      .idle-card { margin:auto; max-width: 720px; width:100%; background: linear-gradient(135deg, var(--panel), var(--panel-2)); border:1px solid var(--border); border-radius:16px; box-shadow: var(--shadow); padding:32px; text-align:center; }
      .idle-title { font-size:22px; font-weight:700; margin-bottom:12px; }
      .idle-sub { color: var(--muted); margin-bottom:24px; }
      .input-row { display:flex; gap:12px; align-items:center; }
      .input { flex:1; border-radius:14px; border:1px solid var(--border); background: rgba(255,255,255,0.02); color: var(--text); padding: 14px 16px; font-size:15px; outline:none; transition: border-color 140ms ease, box-shadow 140ms ease; }
      .input:focus { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(77,163,255,0.18); }
      .btn { border:none; border-radius:12px; background: var(--accent); color:#fff; font-weight:700; padding: 14px 18px; cursor:pointer; box-shadow: 0 14px 38px rgba(77,163,255,0.35); transition: transform 120ms ease, box-shadow 160ms ease, opacity 120ms ease; }
      .btn:disabled { opacity:0.6; cursor:not-allowed; box-shadow:none; }
      .btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 18px 46px rgba(77,163,255,0.45); }
      .active-layout { display:grid; grid-template-columns: 7fr 3fr; gap:16px; }
      .panel-glass { background: linear-gradient(135deg, var(--panel), var(--panel-2)); border:1px solid var(--border); border-radius:16px; box-shadow: var(--shadow); padding:16px; display:flex; flex-direction:column; gap:12px; }
      .panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .panel-title { font-weight:700; font-size:15px; }
      .badge { padding:6px 10px; border-radius:10px; border:1px solid var(--border); font-size:12px; color: var(--muted); }
      .badge.live { color:#bbf7d0; border-color: rgba(50,208,116,0.4); background: rgba(50,208,116,0.08); }
      .badge.fail { color:#ffc7c7; border-color: rgba(255,93,93,0.4); background: rgba(255,93,93,0.08); }
      .code { background: rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:12px; padding:14px; font-family: 'JetBrains Mono', 'SFMono-Regular', Menlo, monospace; white-space: pre-wrap; word-break: break-word; min-height: 180px; position:relative; overflow:auto; }
      .copy { position:absolute; top:10px; right:10px; border:1px solid var(--border); background: rgba(255,255,255,0.05); color: var(--text); border-radius:10px; padding:6px 10px; cursor:pointer; font-size:12px; }
      .context { display:flex; flex-direction:column; gap:10px; font-size:14px; color: var(--muted); }
      .context-row { display:flex; justify-content:space-between; }
      .timeline { border-top:1px solid var(--border); background: rgba(0,0,0,0.12); padding: 14px 18px; overflow-x:auto; }
      .timeline-list { display:flex; gap:16px; align-items:center; min-height: 92px; }
      .timeline-item { display:flex; align-items:center; gap:8px; padding:10px 12px; border-radius:12px; border:1px solid var(--border); background: rgba(255,255,255,0.02); font-size:13px; }
      .timeline-dot { width:10px; height:10px; border-radius:999px; background: #727a88; box-shadow:0 0 0 6px rgba(114,122,136,0.15); }
      .timeline-dot.active { background: var(--accent); box-shadow:0 0 0 6px rgba(77,163,255,0.2); }
      .timeline-dot.done { background: #32D074; box-shadow:0 0 0 6px rgba(50,208,116,0.2); }
      .timeline-dot.fail { background: var(--error); box-shadow:0 0 0 6px rgba(255,93,93,0.18); }
      /* Elliptical light for recent tasks, preserving original dot elsewhere */
      .recent .recent-status .timeline-dot { width:14px; height:9px; border-radius:999px; background-image: radial-gradient(ellipse at 30% 30%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.0) 60%); }
      .typing { display:inline-flex; align-items:center; gap:6px; padding:10px 12px; border-radius:12px; background: rgba(255,255,255,0.04); border:1px solid var(--border); box-shadow: 0 10px 30px rgba(0,0,0,0.18); }
      .typing span { width:8px; height:8px; border-radius:999px; background:#e5e7eb; opacity:0.35; animation: blink 1.4s infinite both; }
      .typing span:nth-child(2){ animation-delay:0.2s; }
      .typing span:nth-child(3){ animation-delay:0.4s; }
      @keyframes blink { 0%{ opacity:0.35; transform:translateY(0); } 30%{ opacity:1; transform:translateY(-2px); } 60%{ opacity:0.35; transform:translateY(0); } 100%{ opacity:0.35; transform:translateY(0);} }
      @media (max-width: 960px) {
        .body { grid-template-columns: 1fr; }
        .sidebar { border-right:none; border-bottom:1px solid var(--border); }
        .active-layout { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <div class="logo"></div>
          <div>Agent OS v0.1</div>
        </div>
        <div class="chips">
          <div id="chipModel" class="chip"><span class="dot green"></span><span>Local model</span></div>
          <div id="chipKernel" class="chip"><span class="dot"></span><span>Kernel: Active</span></div>
          <div class="chip">⚙ Settings</div>
        </div>
      </header>

      <div class="body">
        <aside class="sidebar">
          <h4>Agents</h4>
          <div id="agentList" class="agent-list">
            <div class="agent-row active" data-agent="Web Dev Agent">
              <div class="agent-title"><span class="dot"></span><span>Web Dev Agent</span></div>
              <div class="status"><span>Idle</span><span>•</span><span>Load: 0%</span></div>
              <div class="load-bar"><div class="load-fill" style="width:0%"></div></div>
            </div>
            <div class="agent-row" data-agent="Research Agent">
              <div class="agent-title"><span class="dot"></span><span>Research Agent</span></div>
              <div class="status"><span>Idle</span><span>•</span><span>Load: 0%</span></div>
              <div class="load-bar"><div class="load-fill" style="width:0%"></div></div>
            </div>
            <div class="agent-row" data-agent="System Agent">
              <div class="agent-title"><span class="dot"></span><span>System Agent</span></div>
              <div class="status"><span>Idle</span><span>•</span><span>Load: 0%</span></div>
              <div class="load-bar"><div class="load-fill" style="width:0%"></div></div>
            </div>
          </div>
          <h4 style="margin-top:10px;">Recent Tasks</h4>
          <div id="recentTasks" class="recent"></div>
        </aside>

        <main class="workspace">
          <div id="idleCard" class="idle-card">
            <div class="idle-title">What do you want to build?</div>
            <div class="idle-sub">Single-focus tasking. The system will plan, pick the agent, and stream progress.</div>
            <div class="input-row">
              <input id="input" class="input" placeholder="Create a button with hover animation" />
              <button id="submit" class="btn">Run Task →</button>
            </div>
          </div>

          <div id="activeLayout" class="active-layout" style="display:none;">
            <section class="panel-glass">
              <div class="panel-head">
                <div class="panel-title">Live Output</div>
                <div id="resultBadge" class="badge live">Running</div>
              </div>
              <div class="code" id="liveOutput">
                <button id="copy" class="copy">Copy</button>
                <div id="stream"></div>
              </div>
              <div style="display:flex; justify-content:flex-end; margin-top:8px;">
                <button id="newTask" class="btn" style="display:none; padding:10px 14px; box-shadow:none;">Next</button>
                <button id="continueTask" class="btn" style="display:none; padding:10px 14px; box-shadow:none; margin-left:8px;">Continue</button>
              </div>
            </section>
            <section class="panel-glass">
              <div class="panel-head">
                <div class="panel-title">Agent Context</div>
                <div id="taskId" class="badge">—</div>
              </div>
              <div class="context">
                <div class="context-row"><span>Agent</span><span id="ctxAgent">—</span></div>
                <div class="context-row"><span>Model</span><span id="ctxModel">gpt4all (local)</span></div>
                <div class="context-row"><span>Status</span><span id="ctxStatus">Idle</span></div>
                <div class="context-row"><span>Time</span><span id="ctxTime">—</span></div>
                <div class="context-row"><span>Tools</span><span id="ctxTools">—</span></div>
              </div>
            </section>
          </div>
        </main>
      </div>

      <footer class="timeline">
        <div id="timeline" class="timeline-list"></div>
      </footer>
    </div>

    <script>
      const inputEl = document.getElementById('input');
      const submitBtn = document.getElementById('submit');
      const resultBadge = document.getElementById('resultBadge');
      const liveOutput = document.getElementById('stream');
      const copyBtn = document.getElementById('copy');
      const idleCard = document.getElementById('idleCard');
      const activeLayout = document.getElementById('activeLayout');
      const taskIdEl = document.getElementById('taskId');
      const ctxAgent = document.getElementById('ctxAgent');
      const ctxModel = document.getElementById('ctxModel');
      const ctxStatus = document.getElementById('ctxStatus');
      const ctxTime = document.getElementById('ctxTime');
      const ctxTools = document.getElementById('ctxTools');
      const agentList = document.getElementById('agentList');
      const timelineEl = document.getElementById('timeline');
      const chipKernel = document.getElementById('chipKernel');
      const newTaskBtn = document.getElementById('newTask');
      const continueBtn = document.getElementById('continueTask');
      const recentTasksEl = document.getElementById('recentTasks');
      const typing = document.createElement('div');
      typing.className = 'typing';
      typing.style.display = 'none';
      typing.innerHTML = '<span></span><span></span><span></span>';
      liveOutput.appendChild(typing);

      let currentTaskId = null;
      let pollTimer = null;
      let startTs = null;

      function resetUI() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        currentTaskId = null;
        startTs = null;
        typing.style.display = 'none';
        submitBtn.disabled = false;
        copyBtn.disabled = true;
        setKernelBusy(false);
        resultBadge.textContent = 'Running';
        resultBadge.classList.remove('fail');
        liveOutput.querySelectorAll('.chunk').forEach(n => n.remove());
        ctxStatus.textContent = 'Idle';
        ctxTime.textContent = '—';
        ctxAgent.textContent = '—';
        ctxTools.textContent = '—';
        taskIdEl.textContent = '—';
        timelineEl.innerHTML = '';
        activeLayout.style.display = 'none';
        idleCard.style.display = 'block';
        newTaskBtn.style.display = 'none';
        continueBtn.style.display = 'none';
        loadRecentTasks();
        refreshSchedulerLoads();
      }

      function renderRecentTasks(list) {
        if (!recentTasksEl) return;
        if (!list.length) {
          recentTasksEl.innerHTML = '<div class="muted" style="font-size:12px;">No tasks yet</div>';
          return;
        }
        recentTasksEl.innerHTML = list.map(t => {
          const statusCls = t.status === 'completed' ? 'done' : (t.status === 'failed' ? 'fail' : 'active');
          const statusLabel = t.status === 'completed' ? 'Done' : (t.status === 'failed' ? 'Failed' : 'Running');
          const title = (t.task?.input || t.input || '').slice(0, 60);
          const id = t.task?.id || t.id;
          return '<div class="recent-item" data-id="' + id + '"><div class="recent-title">' + title + '</div><div class="recent-right"><div class="recent-status"><div class="timeline-dot ' + statusCls + '"></div></div><div class="recent-status">' + statusLabel + '</div></div></div>';
        }).join('');
        // Click to open
        recentTasksEl.querySelectorAll('.recent-item').forEach(el => {
          el.addEventListener('click', () => {
            const id = el.getAttribute('data-id');
            if (id) openTask(id);
          });
        });
      }

      async function loadRecentTasks() {
        try {
          const res = await fetch('/tasks');
          if (!res.ok) return;
          const data = await res.json();
          renderRecentTasks(Array.isArray(data) ? data.slice(0, 5) : []);
        } catch (e) {
          // ignore
        }
      }

      async function openTask(taskId) {
        try {
          const res = await fetch('/api/task/' + taskId + '/status');
          if (!res.ok) return;
          const data = await res.json();
          showActiveLayout();
          setKernelBusy(data.status === 'in_progress');
          taskIdEl.textContent = data.task_id || taskId;
          ctxAgent.textContent = data.agent || '—';
          ctxStatus.textContent = data.status || '—';
          if (data.endedAt && data.durationMs) {
            ctxTime.textContent = Math.round((data.durationMs)/1000)+'s';
          } else if (data.startedAt) {
            startTs = data.startedAt;
            const elapsed = Math.max(0, Math.round((Date.now() - startTs)/1000));
            ctxTime.textContent = elapsed + 's';
          } else {
            ctxTime.textContent = '—';
          }
          let displayResult = data.result || data.reason || '';
          if (typeof displayResult === 'string') {
            try { const parsed = JSON.parse(displayResult); if (parsed.result) displayResult = parsed.result; } catch(e) {}
          }
          if (displayResult) setOutput(displayResult);
          if (data.status === 'in_progress') {
            currentTaskId = data.task_id || taskId;
            continueBtn.style.display = 'none';
            newTaskBtn.style.display = 'none';
            startPolling();
          } else {
            currentTaskId = null;
            continueBtn.style.display = 'inline-flex';
            newTaskBtn.style.display = 'inline-flex';
            continueBtn.onclick = () => {
              inputEl.value = data.input || '';
              inputEl.focus();
              submitTask();
            };
          }
        } catch (e) {
          // ignore
        }
      }

      function setKernelBusy(busy) {
        const dot = chipKernel.querySelector('.dot');
        if (!dot) return;
        dot.classList.toggle('green', !busy);
        dot.classList.toggle('red', false);
        chipKernel.querySelector('span:nth-child(2)').textContent = busy ? 'Kernel: Busy' : 'Kernel: Active';
        if (busy) {
          chipKernel.style.animation = 'pulse 1.6s ease-in-out infinite';
        } else {
          chipKernel.style.animation = 'none';
        }
      }

      function setAgentActive(agentName) {
        const rows = agentList.querySelectorAll('.agent-row');
        rows.forEach(r => {
          const isTarget = r.dataset.agent === agentName;
          r.classList.toggle('active', isTarget);
        });
        ctxAgent.textContent = agentName || '—';
      }

      function updateLoad(agentName, loadPct) {
        const row = agentList.querySelector('[data-agent="' + agentName + '"]');
        if (!row) return;
        const status = row.querySelector('.status');
        const fill = row.querySelector('.load-fill');
        if (status) status.innerHTML = '<span>' + (loadPct > 0 ? 'Busy' : 'Idle') + '</span><span>•</span><span>Load: ' + Math.round(loadPct) + '%</span>';
        if (fill) fill.style.width = Math.min(100, Math.max(0, loadPct)) + '%';
      }

      function addTimeline(text, state = 'active') {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        const dot = document.createElement('div');
        dot.className = 'timeline-dot ' + (state === 'done' ? 'done' : state === 'fail' ? 'fail' : 'active');
        const label = document.createElement('div');
        label.textContent = text;
        item.appendChild(dot);
        item.appendChild(label);
        timelineEl.appendChild(item);
        timelineEl.scrollLeft = timelineEl.scrollWidth;
      }

      function markTimelineDone() {
        const dots = timelineEl.querySelectorAll('.timeline-dot.active');
        dots.forEach(d => d.classList.remove('active'));
        dots.forEach(d => d.classList.add('done'));
      }

      function markTimelineFail() {
        const dots = timelineEl.querySelectorAll('.timeline-dot.active');
        dots.forEach(d => d.classList.remove('active'));
        dots.forEach(d => d.classList.add('fail'));
      }

      function showActiveLayout() {
        idleCard.style.display = 'none';
        activeLayout.style.display = 'grid';
        newTaskBtn.style.display = 'none';
      }

      function setResultState(state) {
        resultBadge.textContent = state;
        resultBadge.classList.remove('fail', 'live');
        if (state === 'Failed') resultBadge.classList.add('fail');
        else resultBadge.classList.add('live');
      }

      function setOutput(text) {
        liveOutput.querySelectorAll('.chunk').forEach(n => n.remove());
        const chunk = document.createElement('div');
        chunk.className = 'chunk';
        chunk.textContent = text;
        liveOutput.insertBefore(chunk, typing);
      }

      async function submitTask() {
        const text = inputEl.value.trim();
        if (!text) return;
        submitBtn.disabled = true;
        copyBtn.disabled = true;
        newTaskBtn.style.display = 'none';
        setKernelBusy(true);
        resultBadge.textContent = 'Running';
        liveOutput.querySelectorAll('.chunk').forEach(n => n.remove());
        typing.style.display = 'inline-flex';
        timelineEl.innerHTML = '';
        addTimeline('Task received');
        addTimeline('Validated input');
        addTimeline('Workflow created');
        showActiveLayout();
        startTs = Date.now();
        try {
          const res = await fetch('/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text }) });
          const data = await res.json();
          if (!res.ok || !data.taskId) {
            throw new Error(data.reason || data.error || 'Submit failed');
          }
          currentTaskId = data.taskId;
          taskIdEl.textContent = data.taskId;
          ctxStatus.textContent = 'Running';
          ctxTime.textContent = '—';
          addTimeline('Agent selection pending');
          startPolling();
        } catch (err) {
          setResultState('Failed');
          setOutput('Failed to submit: ' + err.message);
          typing.style.display = 'none';
          submitBtn.disabled = false;
          setKernelBusy(false);
          addTimeline('Submission failed', 'fail');
        }
      }

      async function poll() {
        if (!currentTaskId) return;
        try {
          const res = await fetch('/api/task/' + currentTaskId + '/status');
          if (!res.ok) return;
          const data = await res.json();
          const s = data.status || 'in_progress';
          ctxStatus.textContent = s;
          if (data.agent) {
            setAgentActive(data.agent);
          }
          if (!startTs && data.startedAt) {
            startTs = data.startedAt;
          }
          if (s === 'in_progress' && startTs) {
            const elapsed = Math.max(0, Math.round((Date.now() - startTs)/1000));
            ctxTime.textContent = elapsed + 's';
          }
          if (data.messages && Array.isArray(data.messages)) {
            timelineEl.innerHTML = '';
            data.messages.forEach((m, idx) => {
              const done = idx < data.messages.length - 1;
              const isLast = idx === data.messages.length - 1;
              addTimeline(m.message || m, done ? 'done' : 'active');
              if (done) markTimelineDone();
              if (s === 'failed') markTimelineFail();
            });
          }
          if (s === 'completed' || s === 'failed') {
            clearInterval(pollTimer); pollTimer = null;
            typing.style.display = 'none';
            submitBtn.disabled = false;
            setKernelBusy(false);
            resultBadge.textContent = s === 'completed' ? 'Completed' : 'Failed';
            if (s === 'failed') resultBadge.classList.add('fail');
            else resultBadge.classList.remove('fail');

            let displayResult = data.result || data.reason || '(no output)';
            if (typeof displayResult === 'string') {
              try {
                const parsed = JSON.parse(displayResult);
                if (parsed.result) displayResult = parsed.result;
                if (parsed.model) {
                  ctxModel.textContent = parsed.model.includes('gpt4all') ? 'gpt4all (local)' : parsed.model;
                  const chip = document.getElementById('chipModel');
                  if (chip) {
                    const dot = chip.querySelector('.dot');
                    if (dot) {
                      dot.classList.toggle('green', parsed.model.includes('gpt4all'));
                      dot.classList.toggle('red', false);
                    }
                    chip.querySelector('span:nth-child(2)').textContent = parsed.model.includes('gpt4all') ? 'Local model' : 'Remote fallback';
                  }
                }
              } catch (e) {}
            }
            setOutput(displayResult);
            copyBtn.disabled = !displayResult;
            if (data.durationMs) {
              ctxTime.textContent = Math.round((data.durationMs)/1000) + 's';
            } else if (startTs) {
              const dur = Math.max(0, Math.round((Date.now() - startTs)/1000));
              ctxTime.textContent = dur + 's';
            }
            if (data.agent) setAgentActive(data.agent);
            if (s === 'completed') markTimelineDone(); else markTimelineFail();
            newTaskBtn.style.display = 'inline-flex';
            loadRecentTasks();
            refreshSchedulerLoads();
          }
        } catch (err) {
          console.error(err);
        }
      }

      function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        poll();
        pollTimer = setInterval(() => { poll(); refreshSchedulerLoads(); }, 1200);
      }

      async function refreshSchedulerLoads() {
        try {
          const res = await fetch('/api/scheduler/status');
          if (!res.ok) return;
          const data = await res.json();
          if (data && Array.isArray(data.agents)) {
            data.agents.forEach((slot) => {
              const nameMap = slot.agentId === 'web-dev-agent' ? 'Web Dev Agent'
                            : slot.agentId === 'research-agent' ? 'Research Agent'
                            : slot.agentId === 'system-agent' ? 'System Agent'
                            : slot.agentName;
              updateLoad(nameMap, slot.loadScore || 0);
            });
          }
        } catch (e) {
          // ignore
        }
      }

      submitBtn.onclick = submitTask;
      copyBtn.onclick = () => {
        const chunk = liveOutput.querySelector('.chunk');
        if (!chunk || !chunk.textContent) return;
        navigator.clipboard.writeText(chunk.textContent);
      };
      newTaskBtn.onclick = resetUI;
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitTask();
        }
      });

      loadRecentTasks();
    </script>
  </body>
  </html>`;
}

function metricBox(label: string, id: string): string {
  return (
    '<div class="card" style="margin:0">' +
    `<div class="muted">${label}</div>` +
    `<div id="${id}" style="font-size:28px;font-weight:700;margin-top:4px">0</div>` +
    "</div>"
  );
}

function commonClientHelpers(): string {
  return (
    "function setText(id,v){const el=document.getElementById(id);if(el)el.textContent=String(v);}" +
    "function timeAgo(ts){const d=Date.now()-ts;if(d<60000)return Math.floor(d/1000)+'s ago';if(d<3600000)return Math.floor(d/60000)+'m ago';return Math.floor(d/3600000)+'h ago';}" +
    "function formatMs(ms){if(!ms&&ms!==0)return '—';if(ms<1000)return ms+'ms';return (ms/1000).toFixed(1)+'s';}" +
    // Agents
    "function renderAgents(list,target){const el=document.getElementById(target);if(!el)return;el.innerHTML=list.map(a=>{const cls=a.status==='BUSY'?'busy':(a.status==='READY'?'ready':'idle');const label=a.status==='BUSY'?'BUSY':(a.status==='READY'?'READY':'IDLE');const detail=a.currentTaskId?'Working on '+a.currentTaskId:'Updated '+timeAgo(a.lastUpdated);return \`<div class=\'card\' style=\'margin-bottom:8px\'><div style=\'display:flex;justify-content:space-between;align-items:center\'><div><div style=\'font-weight:600\'>\${a.name}</div><div class=\'muted\'>\${detail}</div></div><span class=\'badge \${cls}\'>\${label}</span></div></div>\`;}).join('');}" +
    // Tasks (cards)
    "function renderTasks(list,target){const el=document.getElementById(target);if(!el)return;el.innerHTML=list.map(t=>{const cls=t.status==='in_progress'?'busy':(t.status==='completed'?'ready':'idle');const label=t.status.toUpperCase().replace('_',' ');const progress=t.progress||0;const time=t.endedAt?formatMs(t.durationMs):timeAgo(t.startedAt);return \`<div class=\'card\' style=\'margin-bottom:8px\'><div style=\'display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:center\'><div><div class=\'muted\'>Task</div><div style=\'font-family:Courier New,monospace\'>\${t.id}</div></div><div><div class=\'muted\'>Agent</div><div>\${t.agent}</div></div><div><div class=\'progress\'><span style=\'width:\${progress}%\'></span></div><div class=\'muted\'>\${progress}%</div></div><span class=\'badge \${cls}\'>\${label}</span></div><div class=\'muted\' style=\'margin-top:6px\'>\${time}</div></div>\`;}).join('');}" +
    // Tasks (table)
    "function renderTasksTable(list,target){const el=document.getElementById(target);if(!el)return;el.innerHTML=\`<table><thead><tr><th>ID</th><th>Agent</th><th>Status</th><th>Progress</th><th>Duration</th><th>Input</th></tr></thead><tbody>\${list.map(t=>{const cls=t.status==='in_progress'?'busy':(t.status==='completed'?'ready':'idle');const label=t.status.toUpperCase().replace('_',' ');const dur=t.durationMs?formatMs(t.durationMs):'—';return \`<tr><td>\${t.id}</td><td>\${t.agent}</td><td><span class=\'badge \${cls}\'>\${label}</span></td><td>\${t.progress||0}%</td><td>\${dur}</td><td title=\"\${t.input||''}\">\${(t.input||'').slice(0,80)}\</td></tr>\`;}).join('')}\</tbody></table>\`; }" +
    // Logs
    "function renderLogs(list,target){const el=document.getElementById(target);if(!el)return;el.innerHTML=list.map(l=>{const cls=l.level==='success'?'log-success':(l.level==='error'?'log-error':'log-info');const ts=new Date(l.ts).toLocaleTimeString();return \`<div class=\'log-line \${cls}\'>[\${ts}] \${l.message}</div>\`;}).join('');}"
  );
}
