import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

/**
 * MCP prompts (shown as slash commands in clients such as Claude Code: /mcp__roxy-ae__review_loop).
 * They only describe a procedure; all work is done through the Roxy tools.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "review_loop",
    {
      title: "Roxy: review & refine loop",
      description: "Iteratively check a composition against criteria with previews and fix it (checkpointed, iteration-limited).",
      argsSchema: z.object({
        comp: z.string().describe("Composition name"),
        goal: z.string().describe("What the result should look like"),
        criteria: z.string().optional().describe("One checkable criterion per line (optional; derived from the goal if omitted)"),
        maxIterations: z.string().optional().describe("Maximum fix iterations (default 3)"),
      }),
    },
    ({ comp, goal, criteria, maxIterations }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Use ONLY the roxy-ae tools to review and refine the After Effects composition "${comp}".`,
              `Goal: ${goal}`,
              criteria ? `Criteria (one per line):\n${criteria}` : "Derive 3-6 concrete, visually checkable criteria from the goal and show them to me before starting.",
              "",
              "Procedure:",
              `1. ae_review_start with comp "${comp}", the goal, the criteria${maxIterations ? ` and maxIterations ${maxIterations}` : ""} (returnImage true).`,
              "2. Look at every returned frame and the autoIssues. Evaluate EACH criterion honestly (pass/fail + short note).",
              "3. ae_review_record: verdict pass if all criteria pass; otherwise verdict fix with concrete plannedChanges.",
              "4. For fix: apply the planned changes with the normal tools (prefer ae_batch_execute), then ae_review_capture and go back to step 2.",
              "5. If a capture looks worse than before, use ae_review_rollback for that iteration.",
              "6. Stop when the verdict is pass, when the tool reports the iteration limit, or when you are unsure - then summarise what changed",
              "   and what I should check myself in After Effects. Do not claim the video is finished or good; I make the final judgement.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "autofix",
    {
      title: "Roxy: find and fix project problems (with approval)",
      description: "Validate the project, propose mechanical fixes, apply only the ones the user approves.",
      argsSchema: z.object({ comp: z.string().optional().describe("Limit to one composition") }),
    },
    ({ comp }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Use ONLY the roxy-ae tools. Run ae_project_autofix${comp ? ` with comp "${comp}"` : ""} without apply.`,
              "List the proposals (id, description, destructive or not) and the manual issues in a table.",
              "Then ASK me which proposal ids to apply. Do not apply anything until I answer.",
              "After I answer, call ae_project_autofix with apply set to exactly the ids I approved and report the validation result.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
