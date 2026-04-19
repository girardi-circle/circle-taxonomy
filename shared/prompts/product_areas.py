PRODUCT_AREAS = [
    {"name": "CMS", "description": "Manages all content creation, organization, and consumption systems that form the core engagement infrastructure of Circle communities.", "covers": ["Website builder", "Posts and comments", "Moderation", "Courses", "Gamification", "Search"]},
    {"name": "Live", "description": "Manages all real-time engagement and communication systems that drive dynamic interaction within Circle communities.", "covers": ["Events", "Live streams and rooms", "Chat spaces", "Direct messages", "Notifications"]},
    {"name": "Paywalls", "description": "Manages the core monetization and access control systems (access groups) that power Circle communities.", "covers": ["Paywall and tax management", "Payment methods and currencies", "Member billing", "Checkout", "Affiliates"]},
    {"name": "Growth", "description": "Manages all acquisition, conversion, and revenue optimization systems that drive Circle business expansion and customer success.", "covers": ["Admin billing", "Community sign-up", "Community onboarding"]},
    {"name": "CRM", "description": "Manages all member relationship and community administration systems that power personalized user experiences in Circle communities.", "covers": ["Audience management", "Sign-up, authentication, and SSO", "Workflows", "Community settings"]},
    {"name": "Email Hub", "description": "Manages the comprehensive email marketing and audience engagement system that powers creator-to-member communications.", "covers": ["Email editor", "Email broadcasts", "Email deliverability"]},
    {"name": "Apps", "description": "Manages the complete mobile experience ecosystem that extends Circle communities beyond the web platform.", "covers": ["Mobile apps", "Desktop app"]},
    {"name": "Circle Plus", "description": "Covers feedback and issues from customers on the Circle Plus plan.", "covers": ["Branded apps", "APIs & SDKs", "Other platform improvements"]},
]

PRODUCT_AREAS_PROMPT_BLOCK = "\n".join(
    f"- {pa['name']}: {pa['description']} Covers: {', '.join(pa['covers'])}."
    for pa in PRODUCT_AREAS
)

PRODUCT_AREA_NAME_TO_ID_MAP: dict[str, int] = {}  # populated at runtime from DB
