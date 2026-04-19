_SYSTEM = "You are a support ticket analyst. You rewrite issue descriptions into high-quality canonical knowledge base entries used for vector similarity search."

def build_reprocess_prompt(verbatim_excerpt: str) -> tuple[str, str]:
    user = f"""Given this verbatim customer transcript excerpt, generate a high-quality segment_description.

Rules:
- 1-2 sentences in neutral, canonical, present-tense language
- Subject must be the product feature or system — never the customer, user, member, or any pronoun
- Describe the general class of problem or request, not this specific incident. Abstract one level up so the description applies to any future occurrence of this issue
- Be specific enough to distinguish this issue from similar ones in vector search — include the relevant feature area, failure mode, and impact
- BAD:  "Member not receiving invitation emails after account deletion and recreation."
- GOOD: "Invitation emails fail to send when a member account is deleted and a new account is created using the same email address, preventing the member from receiving onboarding access to the intended community or space."
- BAD:  "Customer wants space-specific invitations to only grant access to the intended space."
- GOOD: "Space-specific invitation links redirect to the community sales or sign-up page instead of granting scoped access to the target space, causing unintended exposure to the broader community for members who should only access a specific offer or restricted space."

VERBATIM EXCERPT:
{verbatim_excerpt}

Respond with valid JSON only: {{"segment_description": "..."}}"""
    return _SYSTEM, user
