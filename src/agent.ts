/**
 * Provides a runner implementation backed by the GitHub Copilot SDK.
 * It creates a local session, sends the prompt, and ensures the underlying client is stopped
 * even if session teardown fails while the plan is being generated.
 */
import { CopilotClient, type CopilotSession } from "@github/copilot-sdk";
import type { AgentSessionRunner, ImplementationSessionRunner } from "./contracts.js";

export class CopilotAgentSessionRunner implements AgentSessionRunner {
  public constructor(private readonly model = "gpt-5") {}

  public async run(prompt: string, workingDirectory: string): Promise<string> {
    const client = new CopilotClient({ workingDirectory, logLevel: "error" });
    await client.start();
    let session: CopilotSession | undefined;
    try {
      session = await client.createSession({
        model: this.model,
        workingDirectory,
        systemMessage: {
          mode: "append",
          content: "Return only the requested artifact content. Do not use tools or modify files.",
        },
      });
      const response = await session.sendAndWait({ prompt });
      const content = response?.data.content;
      if (!content) throw new Error("Copilot session returned no assistant content");
      return content;
    } finally {
      try {
        if (session) await session.disconnect();
      } finally {
        await client.stop();
      }
    }
  }
}

export class CopilotImplementationSessionRunner implements ImplementationSessionRunner {
  public constructor(private readonly model = "gpt-5") {}

  public async run(prompt: string, workingDirectory: string): Promise<string> {
    const client = new CopilotClient({ workingDirectory, logLevel: "error" });
    await client.start();
    let session: CopilotSession | undefined;
    try {
      session = await client.createSession({
        model: this.model,
        workingDirectory,
        systemMessage: {
          mode: "append",
          content: "Return the requested implementation notes for a separately scoped repository-writing session.",
        },
      });
      const response = await session.sendAndWait({ prompt });
      const content = response?.data.content;
      if (!content) throw new Error("Copilot session returned no assistant content");
      return content;
    } finally {
      try {
        if (session) await session.disconnect();
      } finally {
        await client.stop();
      }
    }
  }
}
