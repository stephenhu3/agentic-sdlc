import type { AgentSessionRunner } from "./contracts.js";
export declare class CopilotAgentSessionRunner implements AgentSessionRunner {
    private readonly model;
    constructor(model?: string);
    run(prompt: string, workingDirectory: string): Promise<string>;
}
