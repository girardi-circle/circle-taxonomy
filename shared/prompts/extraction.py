from shared.prompts.fields import NATURES_PROMPT, INTENTS_PROMPT, SENTIMENTS_PROMPT

_SYSTEM = "You are a support ticket analyst. You extract structured data from customer support transcripts. Your job is to identify issues raised, experienced, or reported by the customer — not observations or explanations made by the support agent."


def build_loggable_prompt() -> tuple[str, str]:
    """Same prompt shape but with raw_text replaced by a placeholder for audit logging."""
    return build_extraction_prompt("[transcript_raw_text]")


def build_extraction_prompt(raw_text: str) -> tuple[str, str]:
    user = f"""Analyze this transcript and extract:

TRANSCRIPT LEVEL:
- summary: 2-3 sentence overview of the entire conversation

ISSUE LEVEL:
Identify each distinct issue that the customer is raising, experiencing, or requesting. Only extract issues from the customer's perspective — ignore anything that is solely an agent observation, explanation, or workaround not directly tied to a customer-reported problem. For each customer issue, provide:
- segment_description: A 1-2 sentence description written in neutral, canonical language, suitable for use as a knowledge base topic definition. This field is used for vector similarity matching, so quality is critical. Follow these rules strictly:
    - Subject must be the product feature or system, not the customer or member. Never use "customer", "user", "member", "she", "he", "they", "we".
    - Describe the general class of problem or request, not the specific incident. Abstract one level up — the description must apply to any future occurrence of this issue, not just this ticket.
    - Use declarative, present-tense language as if defining the issue type.
    - BAD:  "Member not receiving invitation emails after account deletion and recreation."
    - GOOD: "Invitation emails fail to send when a member account is deleted and a new account is created using the same email address, preventing the member from receiving onboarding access to the intended community or space."
    - BAD:  "Customer wants space-specific invitations to only grant access to the intended space."
    - GOOD: "Space-specific invitation links redirect to the community sales or sign-up page instead of granting scoped access to the target space, causing unintended exposure to the broader community for members who should only access a specific offer or restricted space."
- verbatim_excerpt: An array of strings — one element per distinct quote. Each element is a single verbatim excerpt from the transcript relevant to this issue, preserved exactly as spoken. Use multiple elements when the issue is discussed in separate parts of the conversation. Example: ["yeah the drag and drop thing just disappears", "it only happens in Chrome, Firefox is totally fine"]
- nature: exactly one of the following (use the key in lowercase_with_underscores):
{NATURES_PROMPT}
- intent: exactly one of the following (use the key in lowercase):
{INTENTS_PROMPT}
- sentiment: exactly one of {SENTIMENTS_PROMPT}

IMPORTANT: Your response must be raw JSON and nothing else. Do not wrap it in markdown code fences (no ```json or ```). Do not add any text before or after the JSON object. Start your response with {{ and end with }}.

<transcript>
{raw_text}
</transcript>"""
    return _SYSTEM, user
