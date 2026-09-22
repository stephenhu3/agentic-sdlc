import { CopilotClient } from "@github/copilot-sdk";
export class CopilotAgentSessionRunner {
    model;
    constructor(model = "gpt-5") {
        this.model = model;
    }
    async run(prompt, workingDirectory) {
        const client = new CopilotClient({ workingDirectory, logLevel: "error" });
        await client.start();
        let session;
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
            if (!content)
                throw new Error("Copilot session returned no assistant content");
            return content;
        }
        finally {
            if (session)
                await session.disconnect();
            await client.stop();
        }
    }
}
//# sourceMappingURL=agent.js.map