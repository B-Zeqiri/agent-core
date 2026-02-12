/**
 * Research Agent
 * 
 * A production agent that:
 * - Searches the web for information
 * - Analyzes and extracts key points
 * - Stores findings in memory
 * - Generates comprehensive summaries
 * 
 * Demonstrates: Sequential workflows, tool usage, memory integration
 */

import { Agent } from '../kernel/types';
import { Kernel } from '../kernel/kernel';
import { MemoryManager } from '../memory/memoryManager';
import { WebTool } from '../tools/web.tool';
import { ToolManager } from '../tools/toolManager';
import { Orchestrator } from '../orchestration/orchestrator';
import { Task } from '../orchestration/types';

export interface ResearchQuery {
  topic: string;
  depth: 'quick' | 'thorough' | 'comprehensive';
  maxSources?: number;
}

export interface ResearchResult {
  topic: string;
  summary: string;
  keyPoints: string[];
  sources: string[];
  confidence: number;
  timestamp: number;
}

export class ResearchAgent {
  private agentId = 'research-agent';
  private agent: Agent;
  private kernel: Kernel;
  private memory: MemoryManager;
  private toolManager: ToolManager;
  private orchestrator: Orchestrator;

  constructor(
    kernel: Kernel,
    memory: MemoryManager,
    toolManager: ToolManager,
    orchestrator: Orchestrator
  ) {
    this.kernel = kernel;
    this.memory = memory;
    this.toolManager = toolManager;
    this.orchestrator = orchestrator;

    // Create the agent
    this.agent = {
      id: this.agentId,
      name: 'Research Agent',
      model: 'local',
      state: 'uninitialized',
      permissions: ['read', 'network'],
      tags: ['research', 'web', 'analysis'],
      handler: async (input: string) => this.executeResearch(input),
      metadata: {
        capabilities: ['web-search', 'analysis', 'summarization'],
        version: '1.0.0',
      },
    };

    // Register agent
    this.kernel.registerAgent(this.agent);
    this.orchestrator.registerAgent(this.agent);

    // Grant tool permissions
    this.toolManager.grantPermission(this.agentId, 'web-tool');
  }

  /**
   * Execute research workflow
   */
  private async executeResearch(input: string): Promise<string> {
    const query: ResearchQuery = JSON.parse(input);

    // Create research workflow
    const workflow = this.orchestrator.createWorkflow(
      `research-${Date.now()}`,
      `Research: ${query.topic}`,
      this.buildResearchWorkflow(query),
      { topic: query.topic, depth: query.depth }
    );

    // Execute workflow
    const execution = await this.orchestrator.executeWorkflow(workflow.id);

    if (!execution.result?.success) {
      return JSON.stringify({
        error: execution.result?.error || 'Research failed',
      });
    }

    // Extract results
    const result = execution.result.output;
    
    // Store in memory
    await this.storeResearchInMemory(query.topic, result);

    return JSON.stringify(result);
  }

  /**
   * Build research workflow (sequential)
   */
  private buildResearchWorkflow(query: ResearchQuery): Task {
    const maxSources = query.maxSources || this.getMaxSourcesForDepth(query.depth);

    return {
      id: 'research-root',
      type: 'sequential',
      name: 'Research Workflow',
      subtasks: [
        // Step 1: Web search
        {
          id: 'web-search',
          type: 'atomic',
          name: 'Search for information',
          agentId: this.agentId,
          input: {
            action: 'search',
            topic: query.topic,
            maxResults: maxSources,
          },
          timeout: 15000,
          retries: 2,
        },
        // Step 2: Extract key points
        {
          id: 'extract-points',
          type: 'atomic',
          name: 'Extract key points',
          agentId: this.agentId,
          input: {
            action: 'extract',
            depth: query.depth,
          },
          timeout: 10000,
        },
        // Step 3: Generate summary
        {
          id: 'generate-summary',
          type: 'atomic',
          name: 'Generate summary',
          agentId: this.agentId,
          input: {
            action: 'summarize',
            depth: query.depth,
          },
          timeout: 10000,
        },
      ],
    };
  }

  /**
   * Store research findings in memory
   */
  private async storeResearchInMemory(topic: string, result: any): Promise<void> {
    // Store as structured memory
    this.memory.writeShort(
      this.agentId,
      this.agentId,
      JSON.stringify({
        type: 'research',
        topic,
        summary: result.summary,
        keyPoints: result.keyPoints,
        timestamp: Date.now(),
      }),
      'result'
    );

    // Store summary for semantic search
    this.memory.writeLong(
      this.agentId,
      this.agentId,
      `Research on ${topic}: ${result.summary}`,
      'insight'
    );
  }

  /**
   * Get max sources based on depth
   */
  private getMaxSourcesForDepth(depth: string): number {
    switch (depth) {
      case 'quick':
        return 3;
      case 'thorough':
        return 7;
      case 'comprehensive':
        return 15;
      default:
        return 5;
    }
  }

  /**
   * Public API: Research a topic
   */
  async research(query: ResearchQuery): Promise<ResearchResult> {
    const input = JSON.stringify(query);
    const output = await this.agent.handler(input);
    return JSON.parse(output);
  }

  /**
   * Public API: Get past research
   */
  async getPastResearch(topic: string): Promise<any[]> {
    const memories = this.memory.query(this.agentId, this.agentId, {
      keyword: topic,
      limit: 10
    });
    return memories.filter((m: any) => m.content?.type === 'research');
  }

  /**
   * Public API: Get agent stats
   */
  getStats() {
    return {
      agentId: this.agentId,
      state: this.agent.state,
      workflows: this.orchestrator.getSummary(),
      memoryCount: this.memory.query(this.agentId, this.agentId, { limit: 1000 }).length,
    };
  }
}
