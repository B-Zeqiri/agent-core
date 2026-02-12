/**
 * Code Review Agent
 * 
 * A production agent that:
 * - Reads code files
 * - Analyzes multiple aspects in parallel (style, bugs, performance)
 * - Generates comprehensive review report
 * - Suggests improvements
 * 
 * Demonstrates: Parallel workflows, file tools, code analysis
 */

import { Agent } from '../kernel/types';
import { Kernel } from '../kernel/kernel';
import { MemoryManager } from '../memory/memoryManager';
import { ToolManager } from '../tools/toolManager';
import { Orchestrator } from '../orchestration/orchestrator';
import { Task } from '../orchestration/types';

export interface CodeReviewRequest {
  filePath: string;
  focusAreas?: ('style' | 'bugs' | 'performance' | 'security')[];
  severity?: 'all' | 'critical' | 'major';
}

export interface CodeReviewResult {
  filePath: string;
  issues: CodeIssue[];
  suggestions: string[];
  metrics: CodeMetrics;
  overallScore: number;
  timestamp: number;
}

export interface CodeIssue {
  category: string;
  severity: 'critical' | 'major' | 'minor';
  line?: number;
  message: string;
  suggestion?: string;
}

export interface CodeMetrics {
  linesOfCode: number;
  complexity: number;
  maintainability: number;
  testCoverage?: number;
}

export class CodeReviewAgent {
  private agentId = 'code-review-agent';
  private agent: Agent;
  private kernel: Kernel;
  private memory: MemoryManager;
  private toolManager: ToolManager;
  private orchestrator: Orchestrator;

  // Sub-agents for parallel analysis
  private styleAgent: Agent;
  private bugAgent: Agent;
  private perfAgent: Agent;

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

    // Create main agent
    this.agent = {
      id: this.agentId,
      name: 'Code Review Agent',
      model: 'local',
      state: 'uninitialized',
      permissions: ['read', 'execute'],
      tags: ['code-review', 'analysis', 'quality'],
      handler: async (input: string) => this.executeReview(input),
      metadata: {
        capabilities: ['style-check', 'bug-detection', 'performance-analysis'],
        version: '1.0.0',
      },
    };

    // Create specialized sub-agents
    this.styleAgent = {
      id: 'style-analyzer',
      name: 'Style Analyzer',
      model: 'local',
      state: 'uninitialized',
      permissions: ['read'],
      handler: async (code: string) => this.analyzeStyle(code),
      metadata: {
        capabilities: ['style-analysis'],
        version: '1.0.0',
      },
    };

    this.bugAgent = {
      id: 'bug-detector',
      name: 'Bug Detector',
      model: 'local',
      state: 'uninitialized',
      permissions: ['read'],
      handler: async (code: string) => this.detectBugs(code),
      metadata: {
        capabilities: ['bug-detection'],
        version: '1.0.0',
      },
    };

    this.perfAgent = {
      id: 'perf-analyzer',
      name: 'Performance Analyzer',
      model: 'local',
      state: 'uninitialized',
      permissions: ['read'],
      handler: async (code: string) => this.analyzePerformance(code),
      metadata: {
        capabilities: ['performance-analysis'],
        version: '1.0.0',
      },
    };

    // Register all agents
    this.kernel.registerAgent(this.agent);
    this.kernel.registerAgent(this.styleAgent);
    this.kernel.registerAgent(this.bugAgent);
    this.kernel.registerAgent(this.perfAgent);

    this.orchestrator.registerAgent(this.agent);
    this.orchestrator.registerAgent(this.styleAgent);
    this.orchestrator.registerAgent(this.bugAgent);
    this.orchestrator.registerAgent(this.perfAgent);

    // Grant tool permissions
    this.toolManager.grantPermission(this.agentId, 'fs-tool');
    this.toolManager.grantPermission(this.agentId, 'code-tool');
  }

  /**
   * Execute code review workflow
   */
  private async executeReview(input: string): Promise<string> {
    const request: CodeReviewRequest = JSON.parse(input);

    // Create review workflow (parallel analysis)
    const workflow = this.orchestrator.createWorkflow(
      `review-${Date.now()}`,
      `Code Review: ${request.filePath}`,
      this.buildReviewWorkflow(request),
      { filePath: request.filePath }
    );

    // Execute workflow
    const execution = await this.orchestrator.executeWorkflow(workflow.id);

    if (!execution.result?.success) {
      return JSON.stringify({
        error: execution.result?.error || 'Code review failed',
      });
    }

    // Compile results
    const result = this.compileReviewResults(request, execution.result.output);

    // Store review in memory
    await this.storeReviewInMemory(request.filePath, result);

    return JSON.stringify(result);
  }

  /**
   * Build review workflow (parallel analysis)
   */
  private buildReviewWorkflow(request: CodeReviewRequest): Task {
    return {
      id: 'review-root',
      type: 'sequential',
      name: 'Code Review Workflow',
      subtasks: [
        // Step 1: Read file
        {
          id: 'read-file',
          type: 'atomic',
          name: 'Read code file',
          agentId: this.agentId,
          input: {
            action: 'read',
            path: request.filePath,
          },
          timeout: 5000,
        },
        // Step 2: Parallel analysis
        {
          id: 'parallel-analysis',
          type: 'parallel',
          name: 'Analyze code in parallel',
          subtasks: [
            {
              id: 'style-check',
              type: 'atomic',
              name: 'Style analysis',
              agentId: 'style-analyzer',
              timeout: 10000,
            },
            {
              id: 'bug-detection',
              type: 'atomic',
              name: 'Bug detection',
              agentId: 'bug-detector',
              timeout: 10000,
            },
            {
              id: 'perf-analysis',
              type: 'atomic',
              name: 'Performance analysis',
              agentId: 'perf-analyzer',
              timeout: 10000,
            },
          ],
        },
        // Step 3: Generate report
        {
          id: 'generate-report',
          type: 'atomic',
          name: 'Generate review report',
          agentId: this.agentId,
          input: {
            action: 'compile',
            severity: request.severity || 'all',
          },
          timeout: 5000,
        },
      ],
    };
  }

  /**
   * Analyze code style
   */
  private async analyzeStyle(code: string): Promise<string> {
    const issues: CodeIssue[] = [];

    // Simple style checks (in production, use a real linter)
    const lines = code.split('\n');
    
    lines.forEach((line, idx) => {
      if (line.length > 120) {
        issues.push({
          category: 'style',
          severity: 'minor',
          line: idx + 1,
          message: 'Line exceeds 120 characters',
          suggestion: 'Break into multiple lines',
        });
      }
      
      if (line.includes('var ')) {
        issues.push({
          category: 'style',
          severity: 'major',
          line: idx + 1,
          message: 'Use const/let instead of var',
          suggestion: 'Replace var with const or let',
        });
      }
    });

    return JSON.stringify({ issues });
  }

  /**
   * Detect potential bugs
   */
  private async detectBugs(code: string): Promise<string> {
    const issues: CodeIssue[] = [];

    // Simple bug patterns (in production, use static analysis)
    if (code.includes('== null')) {
      issues.push({
        category: 'bugs',
        severity: 'major',
        message: 'Use === for null checks',
        suggestion: 'Replace == with ===',
      });
    }

    if (code.includes('eval(')) {
      issues.push({
        category: 'bugs',
        severity: 'critical',
        message: 'Avoid using eval()',
        suggestion: 'Use safer alternatives',
      });
    }

    if (code.match(/catch\s*\(\s*\w+\s*\)\s*\{\s*\}/)) {
      issues.push({
        category: 'bugs',
        severity: 'major',
        message: 'Empty catch block',
        suggestion: 'Handle or log the error',
      });
    }

    return JSON.stringify({ issues });
  }

  /**
   * Analyze performance
   */
  private async analyzePerformance(code: string): Promise<string> {
    const issues: CodeIssue[] = [];

    // Simple performance checks
    if (code.includes('for (') && code.includes('.length')) {
      const hasLengthCache = code.match(/const\s+\w+\s*=\s*\w+\.length/);
      if (!hasLengthCache) {
        issues.push({
          category: 'performance',
          severity: 'minor',
          message: 'Cache array length in loops',
          suggestion: 'Store array.length in a variable',
        });
      }
    }

    if (code.includes('new RegExp')) {
      issues.push({
        category: 'performance',
        severity: 'minor',
        message: 'Use regex literals instead of new RegExp',
        suggestion: 'Replace with /pattern/ syntax',
      });
    }

    return JSON.stringify({ issues });
  }

  /**
   * Compile review results from parallel analysis
   */
  private compileReviewResults(request: CodeReviewRequest, output: any): CodeReviewResult {
    const allIssues: CodeIssue[] = [];
    
    // Merge issues from all analyzers
    if (output['style-check']) {
      const styleResults = JSON.parse(output['style-check']);
      allIssues.push(...styleResults.issues);
    }
    if (output['bug-detection']) {
      const bugResults = JSON.parse(output['bug-detection']);
      allIssues.push(...bugResults.issues);
    }
    if (output['perf-analysis']) {
      const perfResults = JSON.parse(output['perf-analysis']);
      allIssues.push(...perfResults.issues);
    }

    // Filter by severity if needed
    const filteredIssues = request.severity === 'all' 
      ? allIssues 
      : allIssues.filter(i => i.severity === 'critical' || (request.severity === 'major' && i.severity === 'major'));

    // Calculate metrics
    const metrics: CodeMetrics = {
      linesOfCode: 0, // Would be calculated from actual code
      complexity: allIssues.length,
      maintainability: Math.max(0, 100 - allIssues.length * 5),
    };

    // Calculate score
    const criticalCount = filteredIssues.filter(i => i.severity === 'critical').length;
    const majorCount = filteredIssues.filter(i => i.severity === 'major').length;
    const overallScore = Math.max(0, 100 - (criticalCount * 20 + majorCount * 10));

    return {
      filePath: request.filePath,
      issues: filteredIssues,
      suggestions: filteredIssues.map(i => i.suggestion || '').filter(Boolean),
      metrics,
      overallScore,
      timestamp: Date.now(),
    };
  }

  /**
   * Store review in memory
   */
  private async storeReviewInMemory(filePath: string, result: CodeReviewResult): Promise<void> {
    this.memory.writeShort(
      this.agentId,
      this.agentId,
      JSON.stringify({
        type: 'code-review',
        filePath,
        score: result.overallScore,
        issueCount: result.issues.length,
        timestamp: Date.now(),
      }),
      'result'
    );
  }

  /**
   * Public API: Review code
   */
  async review(request: CodeReviewRequest): Promise<CodeReviewResult> {
    const input = JSON.stringify(request);
    const output = await this.agent.handler(input);
    return JSON.parse(output);
  }

  /**
   * Public API: Get past reviews
   */
  async getPastReviews(filePath?: string): Promise<any[]> {
    const memories = this.memory.query(this.agentId, this.agentId, {
      keyword: filePath,
      limit: 10
    });
    return memories.filter((m: any) => {
      try {
        const content = JSON.parse(m.content);
        return content.type === 'code-review';
      } catch {
        return false;
      }
    });
  }

  /**
   * Public API: Get agent stats
   */
  getStats() {
    return {
      agentId: this.agentId,
      state: this.agent.state,
      subAgents: ['style-analyzer', 'bug-detector', 'perf-analyzer'],
      workflows: this.orchestrator.getSummary(),
      reviewCount: this.memory.query(this.agentId, this.agentId, { limit: 1000 }).length,
    };
  }
}
