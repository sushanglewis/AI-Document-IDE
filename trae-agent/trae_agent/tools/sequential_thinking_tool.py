# Copyright (c) 2023 Anthropic
# Copyright (c) 2025 ByteDance Ltd. and/or its affiliates.
# SPDX-License-Identifier: MIT
#
# This file has been modified by ByteDance Ltd. and/or its affiliates. on 13 June 2025
#
# Original file was released under MIT License, with the full license text
# available at https://github.com/anthropics/anthropic-quickstarts/blob/main/LICENSE
#
# This modified file is released under the same license.

import json
from dataclasses import dataclass
from typing_extensions import override

from trae_agent.tools.base import Tool, ToolCallArguments, ToolExecResult, ToolParameter


@dataclass
class ThoughtData:
    thought: str
    thought_number: int
    total_thoughts: int
    next_thought_needed: bool
    is_revision: bool | None = None
    revises_thought: int | None = None
    branch_from_thought: int | None = None
    branch_id: str | None = None
    needs_more_thoughts: bool | None = None


class SequentialThinkingTool(Tool):
    """A tool for sequential thinking that helps break down complex problems.

    This tool helps analyze problems through a flexible thinking process that can adapt and evolve.
    Each thought can build on, question, or revise previous insights as understanding deepens.
    """

    @override
    def get_name(self) -> str:
        return "sequentialthinking"

    @override
    def get_description(self) -> str:
        return """A detailed tool for dynamic and reflective problem-solving through thoughts.
This tool helps analyze problems through a flexible thinking process that can adapt and evolve.
Each thought can build on, question, or revise previous insights as understanding deepens.

When to use this tool:
- Breaking down complex problems into steps
- Planning and design with room for revision
- Analysis that might need course correction
- Problems where the full scope might not be clear initially
- Problems that require a multi-step solution
- Tasks that need to maintain context over multiple steps
- Situations where irrelevant information needs to be filtered out

Key features:
- You can adjust total_thoughts up or down as you progress
- You can question or revise previous thoughts
- You can add more thoughts even after reaching what seemed like the end
- You can express uncertainty and explore alternative approaches
- Not every thought needs to build linearly - you can branch or backtrack
- Generates a solution hypothesis
- Verifies the hypothesis based on the Chain of Thought steps
- Repeats the process until satisfied
- Provides a correct answer

Parameters explained:
- thought: Your current thinking step, which can include:
* Regular analytical steps
* Revisions of previous thoughts
* Questions about previous decisions
* Realizations about needing more analysis
* Changes in approach
* Hypothesis generation
* Hypothesis verification
- next_thought_needed: True if you need more thinking, even if at what seemed like the end
- thought_number: Current number in sequence (can go beyond initial total if needed)
- total_thoughts: Current estimate of thoughts needed (can be adjusted up/down)
- is_revision: A boolean indicating if this thought revises previous thinking
- revises_thought: If is_revision is true, which thought number is being reconsidered
- branch_from_thought: If branching, which thought number is the branching point
- branch_id: Identifier for the current branch (if any)
- needs_more_thoughts: If reaching end but realizing more thoughts needed

You should:
1. Start with an initial estimate of needed thoughts, but be ready to adjust
2. Feel free to question or revise previous thoughts
3. Don't hesitate to add more thoughts if needed, even at the "end"
4. Express uncertainty when present
5. Mark thoughts that revise previous thinking or branch into new paths
6. Ignore information that is irrelevant to the current step
7. Generate a solution hypothesis when appropriate
8. Verify the hypothesis based on the Chain of Thought steps
9. Repeat the process until satisfied with the solution
10. Provide a single, ideally correct answer as the final output
11. Only set next_thought_needed to false when truly done and a satisfactory answer is reached"""

    @override
    def get_parameters(self) -> list[ToolParameter]:
        return [
            ToolParameter(
                name="thoughts",
                type="array",
                description="The sequential thoughts to solve the problem.",
                items={
                    "type": "object",
                    "properties": {
                        "step": {"type": "integer", "description": "The step number of the thought."},
                        "content": {"type": "string", "description": "The content of the thought."}
                    },
                    "required": ["step", "content"]
                },
                required=True,
            ),
            ToolParameter(
                name="total_thoughts",
                type="integer",
                description="Estimated total thoughts needed. Minimum value is 1.",
                required=True,
            ),
        ]

    def __init__(self, model_provider: str | None = None) -> None:
        super().__init__(model_provider)
        self.thought_history: list[ThoughtData] = []
        self.branches: dict[str, list[ThoughtData]] = {}

    @override
    def get_model_provider(self) -> str | None:
        return self._model_provider

    @override
    async def execute(self, arguments: ToolCallArguments) -> ToolExecResult:
        try:
            thoughts = arguments.get("thoughts")
            total_thoughts = arguments.get("total_thoughts")

            if not thoughts or not isinstance(thoughts, list):
                raise ValueError("thoughts must be a list")

            bubbles = []
            for t in thoughts:
                step = t.get("step")
                content = t.get("content")
                
                # Update history
                self.thought_history.append(ThoughtData(
                    thought=content,
                    thought_number=step,
                    total_thoughts=total_thoughts,
                    next_thought_needed=(step < len(thoughts))
                ))

                bubbles.append({
                    "id": f"thought-{step}",
                    "role": "agent",
                    "content": content,
                    "title": f"Thought {step}",
                    "emoji": "🤔"
                })

            return ToolExecResult(output=json.dumps({
                "thoughts": thoughts,
                "bubbles": bubbles
            }))

        except Exception as e:
            return ToolExecResult(error=str(e))



