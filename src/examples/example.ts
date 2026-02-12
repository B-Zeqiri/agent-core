/**
 * Example 1: Code Analysis & Documentation Pipeline
 *
 * Shows a real-world workflow combining all 3 production agents:
 * - ResearchAgent: Find best practices
 * - CodeReviewAgent: Analyze code quality
 * - CoordinatorAgent: Orchestrate & report
 *
 * Run with: npx ts-node src/examples/example.ts
 */

import { CodeAnalysisPipeline } from './codeAnalysisPipeline';

async function main() {
  const pipeline = new CodeAnalysisPipeline();

  try {
    const result = await pipeline.execute({
      repositoryPath: '/path/to/project',
      techStack: 'TypeScript/Node.js',
      outputPath: './analysis-report.txt',
    });

    // Display the report
    pipeline.printReport(result);

    // Show statistics
    console.log('\n📊 Pipeline Statistics');
    console.log('─'.repeat(50));
    console.log(`Execution Time: ${result.executionTime}ms`);
    console.log(
      `Code Quality Score: ${result.codeReviewResults.overallScore}/100`
    );
    console.log(`Best Practices Found: ${result.researchFindings.bestPractices.length}`);
    console.log(`Issues Identified: ${result.codeReviewResults.analyses.reduce((sum: number, a: any) => sum + a.issues.length, 0)}`);
  } catch (error) {
    console.error('Pipeline execution failed:', error);
    process.exit(1);
  }
}

main();
