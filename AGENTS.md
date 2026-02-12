# Production Agents Guide

## Overview

Agent Core OS includes 3 production-ready agents that demonstrate the framework's capabilities:

1. **ResearchAgent** - Sequential workflow with web search and summarization
2. **CodeReviewAgent** - Parallel workflow with specialized sub-agents
3. **CoordinatorAgent** - Multi-agent coordination via IPC

All agents are fully tested and integrate with:
- Kernel (agent registration & lifecycle)
- Memory Manager (isolated memory with ACLs)
- Tool Manager (permission-based tool access)
- Orchestrator (workflow execution)
- Message Bus (inter-agent communication)

## ResearchAgent

**Purpose**: Demonstrate sequential workflow patterns for research tasks

**Capabilities**:
- `web-search` - Web search and data gathering
- `analysis` - Content analysis and extraction
- `summarization` - Generate research summaries

**Workflow Pattern**: Sequential
```typescript
web-search → extract-points → generate-summary
```

**Usage**:
```typescript
import { ResearchAgent } from './agents/researchAgent';

const agent = new ResearchAgent(kernel, memory, toolManager, orchestrator);

// Perform research
const result = await agent.research({
  topic: 'TypeScript best practices',
  depth: 'thorough',  // 'quick' | 'thorough' | 'comprehensive'
  maxSources: 5
});

// Result structure:
{
  topic: string;
  summary: string;
  keyPoints: string[];
  sources: string[];
  confidence: number;
  timestamp: number;
}

// Get past research
const history = await agent.getPastResearch('TypeScript');

// Get stats
const stats = agent.getStats();
// { agentId, state, workflows, memoryCount }
```

**Tools Required**:
- `web-tool` - For web searches

**Memory Usage**:
- Short-term: Recent search results (structured data)
- Long-term: Research summaries (for semantic search)

## CodeReviewAgent

**Purpose**: Demonstrate parallel workflows with specialized sub-agents

**Capabilities**:
- `style-check` - Code style and formatting analysis
- `bug-detection` - Potential bugs and code smells
- `performance-analysis` - Performance optimization suggestions

**Sub-Agents**:
1. **StyleAnalyzer** (`style-analyzer`) - Style checks
2. **BugDetector** (`bug-detector`) - Bug detection
3. **PerformanceAnalyzer** (`perf-analyzer`) - Performance analysis

**Workflow Pattern**: Sequential → Parallel → Sequential
```typescript
read-file →
  [style-check || bug-detection || perf-analysis]  (parallel)
→ generate-report
```

**Usage**:
```typescript
import { CodeReviewAgent } from './agents/codeReviewAgent';

const agent = new CodeReviewAgent(kernel, memory, toolManager, orchestrator);

// Review code
const result = await agent.review({
  filePath: 'src/example.ts',
  includeStyle: true,
  includeBugs: true,
  includePerformance: true
});

// Result structure:
{
  filePath: string;
  issues: Array<{
    type: 'style' | 'bug' | 'performance';
    severity: 'low' | 'medium' | 'high';
    message: string;
    line?: number;
    suggestion?: string;
  }>;
  overallScore: number;  // 0-100
  timestamp: number;
}

// Get past reviews
const history = await agent.getPastReviews('src/example.ts');

// Get stats
const stats = agent.getStats();
// { agentId, state, subAgents, workflows, reviewCount }
```

**Tools Required**:
- `fs-tool` - For reading files
- `code-tool` - For code analysis

**Memory Usage**:
- Short-term: Review results with metadata
- Separate memory spaces for each sub-agent

**Sub-Agent Coordination**:
All sub-agents run in parallel, each with its own:
- Agent ID and registration
- Memory space
- Analysis function
- Orchestrator integration

## CoordinatorAgent

**Purpose**: Demonstrate multi-agent coordination and IPC patterns

**Capabilities**:
- `agent-coordination` - Coordinate multiple agents
- `workflow-orchestration` - Dynamic workflow generation
- `decision-making` - Strategy selection based on request

**Workflow Patterns**:
- **Sequential**: Execute agents one after another
- **Parallel**: Execute multiple agents simultaneously
- **Adaptive**: Mix sequential and parallel based on dependencies

**Usage**:
```typescript
import { CoordinatorAgent } from './agents/coordinatorAgent';

const agent = new CoordinatorAgent(kernel, messageBus, toolManager, orchestrator);

// Coordinate multiple agents
const result = await agent.coordinate({
  goal: 'Analyze and improve code quality',
  agentIds: ['research-agent', 'code-review-agent'],
  strategy: 'parallel',  // 'sequential' | 'parallel' | 'adaptive'
  timeout: 30000
});

// Result structure:
{
  goal: string;
  strategy: string;
  agentsUsed: string[];
  results: Record<string, any>;
  executionTime: number;
  success: boolean;
  timestamp: number;
}

// Send message to specific agent
await agent.sendMessageToAgent('target-agent-id', {
  action: 'analyze',
  data: { ... }
});

// Broadcast to multiple agents
await agent.broadcastToAgents(
  ['agent-1', 'agent-2'],
  { command: 'start' }
);

// Request and aggregate responses
const responses = await agent.requestFromAgents(
  ['agent-1', 'agent-2'],
  { query: 'status' },
  5000  // timeout
);

// Subscribe to messages from specific agent
const unsubscribe = agent.subscribeToAgent('other-agent', (msg) => {
  console.log('Received:', msg.payload);
});
// Later: unsubscribe();

// Get stats
const stats = agent.getStats();
// { agentId, state, messagesReceived, workflows }
```

**IPC Integration**:
- Publishes messages to `agent:{targetAgentId}` channels
- Subscribes to `agent:{coordinatorAgentId}` for incoming messages
- Uses IPCMessage format: `{ id, from, to, type, payload, timestamp }`

**Strategy Selection**:
The coordinator automatically decides execution strategy based on:
- Number of agents
- Agent dependencies
- Goal complexity
- Performance requirements

## Testing

All agents have comprehensive test coverage:

```bash
npm run test:agents
```

**Test Suite** (33 tests):
- Research Agent (6 tests)
  - Registration, capabilities, stats
  - Memory integration
  - Tool permissions
- Code Review Agent (9 tests)
  - Main agent + 3 sub-agents registration
  - Capabilities and tool permissions
  - Sub-agent orchestration
- Coordinator Agent (7 tests)
  - IPC message handling
  - Agent subscription
  - Message storage
- Integration Tests (6 tests)
  - Multi-agent registration
  - Unique IDs
  - Shared resources
  - Metadata presence
- Workflow Patterns (4 tests)
  - Sequential workflows
  - Parallel workflows
  - Coordination patterns
- Capabilities Tests (7 tests)
  - Capability verification
  - Version tracking

## Architecture Patterns

### 1. Sequential Workflows (ResearchAgent)
**Use when**: Tasks must execute in order
**Pattern**: Output of step N becomes input to step N+1
```typescript
const workflow: Task = {
  type: 'sequential',
  subtasks: [task1, task2, task3]
};
```

### 2. Parallel Workflows (CodeReviewAgent)
**Use when**: Tasks can execute independently
**Pattern**: All tasks run simultaneously, results aggregated
```typescript
const workflow: Task = {
  type: 'parallel',
  subtasks: [taskA, taskB, taskC]
};
```

### 3. IPC Coordination (CoordinatorAgent)
**Use when**: Agents need to communicate
**Pattern**: Message passing via pub/sub
```typescript
messageBus.publish('agent:target', {
  id: uuid(),
  from: 'coordinator',
  to: 'target',
  type: 'request',
  payload: data,
  timestamp: Date.now()
});
```

## Memory Best Practices

### Isolated Memory
Each agent has its own memory space:
```typescript
// Create agent memory (once)
memoryManager.createAgentMemory('my-agent-id');

// Write to own memory
memoryManager.writeShort(
  'my-agent-id',    // writer
  'my-agent-id',    // target
  content,
  'result'
);
```

### Memory Sharing (if needed)
```typescript
// Grant agent A read access to agent B's memory
memoryManager.shareMemoryRead('agent-a-memory', 'agent-a-id');

// Now agent A can query
const memories = memoryManager.query(
  'agent-a-id',
  'agent-a-memory',
  { limit: 10 }
);
```

### Memory Types
- **Short-term**: Recent context, limited size, auto-overflow to long-term
- **Long-term**: Persistent storage, searchable, unlimited size

## Tool Permissions

Agents must be granted explicit permissions:

```typescript
// Register tool first
toolManager.registerTool(new MyTool());

// Grant permission to agent
toolManager.grantPermission('agent-id', 'tool-name');

// Check permission
const allowed = toolManager.canUseTool('agent-id', 'tool-name');

// Call tool (enforces permissions)
const result = await toolManager.callTool('agent-id', 'tool-name', args);
```

## Workflow Execution

Using the Orchestrator:

```typescript
// 1. Register agent
orchestrator.registerAgent(agent);

// 2. Create workflow
const workflowId = orchestrator.createWorkflow({
  id: 'my-workflow',
  rootTask: buildMyTask(),
  retryPolicy: { maxRetries: 3, backoffMs: 1000 }
});

// 3. Execute workflow
const result = await orchestrator.executeWorkflow(workflowId);

// 4. Get metrics
const metrics = orchestrator.getMetrics();
const summary = orchestrator.getSummary();
```

## Error Handling

All agents handle errors gracefully:

```typescript
try {
  const result = await agent.doSomething(input);
} catch (error) {
  // Agents return structured errors
  console.error('Agent error:', error);
  // Execution marked as failed in orchestrator
  // Error logged in agent memory
}
```

## Performance Considerations

### ResearchAgent
- Web searches can be slow (network bound)
- Adjust `depth` parameter for speed vs thoroughness
- Results cached in memory for quick retrieval

### CodeReviewAgent
- Parallel sub-agents maximize throughput
- File reading is I/O bound
- 3 concurrent analyzers complete in ~1/3 the time of sequential

### CoordinatorAgent
- Message passing has minimal overhead
- Strategy selection impacts total execution time
- Adaptive strategy balances speed and dependencies

## Extension Examples

### Creating a Custom Agent

```typescript
import { Agent } from '../kernel/types';
import { Kernel } from '../kernel/kernel';
import { MemoryManager } from '../memory/memoryManager';
import { ToolManager } from '../tools/toolManager';
import { Orchestrator } from '../orchestration/orchestrator';

export class MyCustomAgent {
  private agentId = 'my-agent';
  private agent: Agent;

  constructor(
    kernel: Kernel,
    memory: MemoryManager,
    toolManager: ToolManager,
    orchestrator: Orchestrator
  ) {
    // Create agent
    this.agent = {
      id: this.agentId,
      name: 'My Custom Agent',
      model: 'local',
      state: 'uninitialized',
      permissions: ['read'],
      tags: ['custom'],
      handler: async (input: string) => this.execute(input),
      metadata: {
        capabilities: ['my-capability'],
        version: '1.0.0',
      },
    };

    // Register
    kernel.registerAgent(this.agent);
    orchestrator.registerAgent(this.agent);

    // Grant permissions
    toolManager.grantPermission(this.agentId, 'my-tool');
  }

  private async execute(input: string): Promise<string> {
    // Your agent logic here
    return JSON.stringify({ result: 'success' });
  }
}
```

## Next Steps

1. **Extend agents**: Add more capabilities to existing agents
2. **Create new agents**: Build specialized agents for your use case
3. **Compose workflows**: Combine agents in complex orchestrations
4. **Add tools**: Create custom tools for agent capabilities
5. **Monitor performance**: Use observability features to track metrics

## See Also

- [STATUS.md](STATUS.md) - Overall framework status
- [src/orchestration/](src/orchestration/) - Workflow orchestration details
- [src/ipc/](src/ipc/) - Inter-process communication
- [src/memory/](src/memory/) - Memory management
- [src/tools/](src/tools/) - Tool system
