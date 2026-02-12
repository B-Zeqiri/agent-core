/**
 * Code Analysis Pipeline Tests
 *
 * Validates the complete example workflow
 */

import { CodeAnalysisPipeline } from './codeAnalysisPipeline';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
};

function pass(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function fail(msg: string) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
  process.exit(1);
}

function section(msg: string) {
  console.log(`\n${colors.blue}→${colors.reset} ${msg}`);
}

async function assert(condition: boolean, msg: string) {
  if (condition) {
    pass(msg);
  } else {
    fail(msg);
  }
}

async function runTests() {
  console.log(`\n${colors.blue}=== EXAMPLE 1: CODE ANALYSIS PIPELINE TESTS ===${colors.reset}\n`);

  const pipeline = new CodeAnalysisPipeline();

  // Test 1: Execute pipeline
  section('Pipeline Execution');

  const result = await pipeline.execute({
    repositoryPath: '/example/repo',
    techStack: 'TypeScript',
  });

  await assert(result !== undefined, 'Pipeline executed successfully');
  await assert(result.executionTime > 0, 'Execution time tracked');

  // Test 2: Research phase
  section('Research Phase Output');

  await assert(
    result.researchFindings !== undefined,
    'Research findings available'
  );
  await assert(
    result.researchFindings.bestPractices.length > 0,
    'Best practices identified'
  );
  await assert(
    result.researchFindings.confidence > 0.8,
    'High confidence research'
  );
  await assert(
    result.researchFindings.sources > 0,
    'Sources consulted'
  );

  // Test 3: Code review phase
  section('Code Review Phase Output');

  await assert(
    result.codeReviewResults !== undefined,
    'Code review results available'
  );
  await assert(
    result.codeReviewResults.overallScore > 0,
    'Overall quality score calculated'
  );
  await assert(
    result.codeReviewResults.overallScore <= 100,
    'Score within valid range'
  );
  await assert(
    result.codeReviewResults.analyses.length === 3,
    '3 analysis types performed (style, bugs, performance)'
  );
  await assert(
    result.codeReviewResults.filesAnalyzed > 0,
    'Files were analyzed'
  );

  // Test 4: Analysis details
  section('Analysis Details');

  const styleAnalysis = result.codeReviewResults.analyses[0];
  await assert(styleAnalysis.name === 'Style Analysis', 'Style analysis included');
  await assert(styleAnalysis.score > 0, 'Style score provided');
  await assert(styleAnalysis.issues !== undefined, 'Style issues identified');

  const bugAnalysis = result.codeReviewResults.analyses[1];
  await assert(bugAnalysis.name === 'Bug Detection', 'Bug detection included');
  await assert(bugAnalysis.score > 0, 'Bug score provided');
  await assert(bugAnalysis.issues !== undefined, 'Potential bugs identified');

  const perfAnalysis = result.codeReviewResults.analyses[2];
  await assert(
    perfAnalysis.name === 'Performance Analysis',
    'Performance analysis included'
  );
  await assert(perfAnalysis.score > 0, 'Performance score provided');
  await assert(perfAnalysis.issues !== undefined, 'Performance issues identified');

  // Test 5: Final report
  section('Final Report Generation');

  await assert(result.finalReport !== undefined, 'Final report generated');
  await assert(
    result.finalReport.includes('CODE ANALYSIS & DOCUMENTATION REPORT'),
    'Report has correct title'
  );
  await assert(
    result.finalReport.includes('EXECUTIVE SUMMARY'),
    'Report includes executive summary'
  );
  await assert(
    result.finalReport.includes('RESEARCH FINDINGS'),
    'Report includes research section'
  );
  await assert(
    result.finalReport.includes('CODE QUALITY ANALYSIS'),
    'Report includes code quality section'
  );
  await assert(
    result.finalReport.includes('RECOMMENDATIONS'),
    'Report includes recommendations'
  );
  await assert(
    result.finalReport.includes('NEXT STEPS'),
    'Report includes action items'
  );

  // Test 6: Multi-phase workflow
  section('Multi-Phase Workflow Validation');

  await assert(
    result.researchFindings.techStack !== undefined,
    'Research phase preserved context'
  );
  await assert(
    result.codeReviewResults.repositoryPath !== undefined,
    'Code review phase preserved context'
  );
  await assert(
    result.finalReport.includes(result.researchFindings.techStack),
    'Final report includes research findings'
  );
  await assert(
    result.finalReport.includes(
      result.codeReviewResults.overallScore.toString()
    ),
    'Final report includes code quality scores'
  );

  // Test 7: Report quality
  section('Report Quality Metrics');

  const reportLength = result.finalReport.length;
  await assert(reportLength > 500, 'Report is substantial (>500 chars)');
  await assert(
    reportLength < 5000,
    'Report is concise (<5000 chars)'
  );

  const sections = [
    'EXECUTIVE SUMMARY',
    'RESEARCH FINDINGS',
    'CODE QUALITY ANALYSIS',
    'RECOMMENDATIONS',
    'NEXT STEPS',
  ];
  for (const section of sections) {
    await assert(
      result.finalReport.includes(section),
      `Report contains "${section}" section`
    );
  }

  console.log(`\n${colors.green}✅ All example tests passed!${colors.reset}`);
  console.log(`\n📊 Example Statistics:`);
  console.log(`   Execution Time: ${result.executionTime}ms`);
  console.log(`   Code Quality Score: ${result.codeReviewResults.overallScore}/100`);
  console.log(
    `   Best Practices: ${result.researchFindings.bestPractices.length}`
  );
  console.log(
    `   Issues Found: ${result.codeReviewResults.analyses.reduce((sum: number, a: any) => sum + a.issues.length, 0)}`
  );
}

runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
