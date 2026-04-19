NATURES = ["Bug", "Feedback", "Question", "Complaint", "Feature Request", "Exploration", "Cancellation"]
INTENTS = ["Support", "Action", "Insights", "Strategy", "Sales"]
SENTIMENTS = ["positive", "negative", "neutral", "frustrated"]

NATURE_DESCRIPTIONS = {
    "Bug":             "A defect or malfunction in existing functionality that is not working as expected.",
    "Feedback":        "General observations or opinions about the product experience without a specific ask.",
    "Question":        "A request for information or clarification about how something works.",
    "Complaint":       "An expression of dissatisfaction about the product or service experience.",
    "Feature Request": "A request for new functionality or capability that does not currently exist.",
    "Exploration":     "Open-ended discussion about possibilities, use cases, or future direction.",
    "Cancellation":    "Customer requesting to cancel their subscription, membership, or account.",
}

NATURES_PROMPT = "\n".join(
    f"  - {name}: {NATURE_DESCRIPTIONS[name]}"
    for name in NATURES
)
INTENT_DESCRIPTIONS = {
    "Support":  "Customer is seeking help to resolve an issue or get unblocked.",
    "Action":   "Customer is requesting a specific action to be taken on their behalf.",
    "Insights": "Customer is seeking data, analytics, or deeper understanding of their usage.",
    "Strategy": "Customer is discussing long-term plans, direction, or strategic alignment with the product.",
    "Sales":    "Conversation involves purchasing, pricing, renewals, or commercial terms.",
}

INTENTS_PROMPT = "\n".join(
    f"  - {name}: {INTENT_DESCRIPTIONS[name]}"
    for name in INTENTS
)
SENTIMENTS_PROMPT = "[" + ", ".join(SENTIMENTS) + "]"


def validate_nature(value: str) -> str | None:
    lookup = {n.lower().replace(" ", "_"): n for n in NATURES}
    return lookup.get(value.lower().replace(" ", "_"))


def validate_intent(value: str) -> str | None:
    lookup = {i.lower(): i for i in INTENTS}
    return lookup.get(value.lower())


def validate_sentiment(value: str) -> str | None:
    return value.lower() if value.lower() in SENTIMENTS else None
