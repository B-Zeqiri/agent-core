import { Orchestrator } from "./src/orchestration/orchestrator";
import { Kernel } from "./src/kernel/kernel";
import { Agent } from "./src/kernel/types";
import { Task } from "./src/orchestration/types";
import { webDevAgent } from "./src/agents/webDevAgent";

async function test() {
  try {
    console.log("Starting orchestrator test with OpenAI...");

    const kernel = new Kernel();
    const orchestrator = new Orchestrator();

    // Create agent with OpenAI handler
    const testAgent: Agent = {
      id: "web-dev-agent",
      name: "Web Dev Agent",
      model: "local",
      state: "uninitialized",
      handler: async (input: string) => {
        console.log("Agent handler called with input length:", input.length);
        try {
          let userQuery = input;
          try {
            const parsed = JSON.parse(input);
            userQuery = parsed.query || input;
          } catch {
            userQuery = input;
          }

          console.log("Querying gpt4all with:", userQuery.substring(0, 50));
          const { OpenAI } = await import("openai");
          const client = new OpenAI({
            baseURL: "http://localhost:4891/v1",
            apiKey: "not-used",
          });

          const response = await client.chat.completions.create({
            model: "gpt4all",
            messages: [
              {
                role: "system",
                content: webDevAgent.systemPrompt,
              },
              {
                role: "user",
                content: userQuery,
              },
            ],
            temperature: 0.7,
            max_tokens: 2000,
          });

          const output = response.choices[0]?.message?.content || "No response";
          console.log("Got response from gpt4all");
          return output;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error("Agent error:", msg);
          throw new Error(`Agent handler error: ${msg}`);
        }
      },
      metadata: {
        capabilities: ["code-generation"],
        version: "1.0.0",
      },
    };

    console.log("Registering agent...");
    kernel.registerAgent(testAgent);
    orchestrator.registerAgent(testAgent);
    kernel.startAgent(testAgent.id);

    console.log("Creating workflow...");
    const task: Task = {
      id: "test-task",
      type: "atomic",
      name: "Test Task",
      agentId: "web-dev-agent",
      input: { query: "What is TypeScript in one sentence?" },
    };

    const workflowId = orchestrator.createWorkflow(
      "test-workflow",
      "Test Workflow",
      task
    ).id;

    console.log("Executing workflow...");
    const execution = await orchestrator.executeWorkflow(workflowId);

    console.log("\nWorkflow completed:");
    console.log("Status:", execution.status);
    console.log("Output:", execution.result?.output?.substring(0, 100));
    console.log("Error:", execution.error);

    process.exit(0);
  } catch (error) {
    console.error("Test error:", error);
    process.exit(1);
  }
}

test();
