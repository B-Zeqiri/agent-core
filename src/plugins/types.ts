import type { AgentDefinition, AgentMeta, AgentResult, AgentContext, Task, Permissions } from "@agentos/sdk";

export type { AgentDefinition, AgentMeta, AgentResult, AgentContext, Task, Permissions };

export interface LoadedPluginAgent {
  definition: AgentDefinition;
  entryPath: string;
}
