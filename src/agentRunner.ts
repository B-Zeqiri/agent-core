import OpenAI from "openai";
import { webDevAgent } from "./agents/webDevAgent";
import { writeText } from "./tools/writer";
import { memory } from "./memory/memory";

const client = new OpenAI({
  apiKey: "not-needed",
  baseURL: "http://localhost:4891/v1",
  timeout: 120000 // 2 minutes
});

export async function runAgent(task: string) {
  try {
    console.log("Sending request to gpt4all...");
    
    const response = await client.chat.completions.create({
      model: "Phi-3 Mini Instruct",
      messages: [
        { role: "system", content: webDevAgent.systemPrompt },
        { role: "user", content: task }
      ],
      max_tokens: 1024
    });

    console.log("Response received from gpt4all");
    const output = response.choices[0].message.content || "";
    memory.history.push(task);
    return writeText(output);
  } catch (err) {
    console.error("Error running agent:", err);
    return `Failed to complete task: ${err instanceof Error ? err.message : String(err)}`;
  }
}
