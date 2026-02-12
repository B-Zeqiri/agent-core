/**
 * Code Tool
 *
 * Parse, analyze, and generate code.
 * Does NOT execute code (that's dangerous).
 * Focuses on analysis, formatting, parsing.
 */

import { BaseTool, ToolConfig } from "./tool.interface";

export class CodeTool extends BaseTool {
  /**
   * Execute code operations
   */
  async execute(args: Record<string, any>): Promise<any> {
    const startTime = Date.now();

    try {
      const validation = this.validate(args);
      if (!validation.valid) {
        throw new Error(validation.errors?.join(", ") || "Invalid arguments");
      }

      const operation = args.operation;
      let result: any;

      switch (operation) {
        case "analyze":
          result = this.analyze(args.code, args.language);
          break;
        case "format":
          result = this.format(args.code, args.language);
          break;
        case "parse":
          result = this.parse(args.code, args.language);
          break;
        case "lint":
          result = this.lint(args.code, args.language);
          break;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      const executionTime = Date.now() - startTime;
      this.recordCall(true, executionTime);

      return result;
    } catch (err) {
      const executionTime = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordCall(false, executionTime, errorMsg);
      throw err;
    }
  }

  validate(args: Record<string, any>) {
    const errors: string[] = [];

    if (!args.operation) {
      errors.push("operation is required");
    }

    if (!args.code) {
      errors.push("code is required");
    }

    if (!args.language) {
      errors.push("language is required");
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async isHealthy(): Promise<boolean> {
    // Code tool is always healthy (no external dependencies)
    return true;
  }

  // ============ PRIVATE ============

  private analyze(code: string, language: string): Record<string, any> {
    const lines = code.split("\n");
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);

    // Simple analysis
    const stats = {
      language,
      totalLines: lines.length,
      codeLines: nonEmptyLines.length,
      blankLines: lines.length - nonEmptyLines.length,
      estimatedComplexity: this.estimateComplexity(code),
      functions: this.countFunctions(code, language),
      classes: this.countClasses(code, language),
    };

    return stats;
  }

  private format(code: string, language: string): string {
    // Simple formatting: normalize indentation
    const lines = code.split("\n");

    return lines
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return "";

        // Count leading spaces/tabs
        const indent = line.match(/^\s*/)?.[0] || "";
        const indentLevel = Math.floor(indent.length / 2);

        return "  ".repeat(indentLevel) + trimmed;
      })
      .join("\n");
  }

  private parse(code: string, language: string): Record<string, any> {
    // Simple parsing: extract structure
    const tokens = this.tokenize(code);

    return {
      language,
      tokens: tokens.length,
      tokenTypes: this.countTokenTypes(tokens),
    };
  }

  private lint(code: string, language: string): Array<{
    line: number;
    issue: string;
    severity: string;
  }> {
    const issues: Array<{ line: number; issue: string; severity: string }> = [];
    const lines = code.split("\n");

    lines.forEach((line, idx) => {
      // Check for common issues
      if (line.includes("\t")) {
        issues.push({
          line: idx + 1,
          issue: "Tabs should be replaced with spaces",
          severity: "warning",
        });
      }

      if (line.trim().length > 100) {
        issues.push({
          line: idx + 1,
          issue: "Line exceeds 100 characters",
          severity: "info",
        });
      }

      if (line.match(/\s+$/)) {
        issues.push({
          line: idx + 1,
          issue: "Trailing whitespace",
          severity: "warning",
        });
      }
    });

    return issues;
  }

  private estimateComplexity(code: string): number {
    const ifCount = (code.match(/\bif\b/gi) || []).length;
    const forCount = (code.match(/\bfor\b/gi) || []).length;
    const whileCount = (code.match(/\bwhile\b/gi) || []).length;
    const switchCount = (code.match(/\bswitch\b/gi) || []).length;

    return 1 + ifCount + forCount + whileCount + switchCount * 2;
  }

  private countFunctions(code: string, language: string): number {
    if (language === "javascript" || language === "typescript") {
      return (code.match(/function\s|=>\s|async\s+function/gi) || []).length;
    }

    if (language === "python") {
      return (code.match(/def\s/gi) || []).length;
    }

    return (code.match(/function|def\s/gi) || []).length;
  }

  private countClasses(code: string, language: string): number {
    return (code.match(/class\s|interface\s/gi) || []).length;
  }

  private tokenize(code: string): string[] {
    return code.match(/\w+|[^\w\s]/g) || [];
  }

  private countTokenTypes(tokens: string[]): Record<string, number> {
    const types: Record<string, number> = {
      identifiers: 0,
      keywords: 0,
      operators: 0,
      punctuation: 0,
    };

    const keywords = new Set([
      "if",
      "for",
      "while",
      "function",
      "class",
      "return",
      "const",
      "let",
      "var",
      "async",
      "await",
      "import",
      "export",
    ]);

    tokens.forEach((token) => {
      if (keywords.has(token)) {
        types.keywords++;
      } else if (/^[a-zA-Z_]\w*$/.test(token)) {
        types.identifiers++;
      } else if (/[+\-*/=<>!&|^%]/.test(token)) {
        types.operators++;
      } else {
        types.punctuation++;
      }
    });

    return types;
  }
}
