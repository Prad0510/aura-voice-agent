import json
import os

from dotenv import load_dotenv
from google import genai


def generate_call_summary(transcript):
    load_dotenv()

    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise ValueError("GEMINI_API_KEY is missing")

    client = genai.Client(
        api_key=api_key
    )

    conversation = "\n".join(
        f"{item['speaker']}: {item['text']}"
        for item in transcript
    )

    prompt = f"""
You are a customer support call analyst for Aura Skincare.

Analyze the following completed customer support conversation.

Your job is to produce a concise, factual structured summary.

IMPORTANT:
- Use ONLY information present in the conversation.
- Do not invent actions, policies, order information, or outcomes.
- Determine the customer's main intent from the conversation.
- Identify the order ID if one was discussed.
- Determine whether the customer's issue was actually resolved.
- If the agent could only provide information but could not complete
  an action, reflect that in the resolution status.
- If the customer had an unresolved problem, do not call it resolved.
- Do not copy the customer's entire speech into the summary.
- Write a short natural-language summary of what actually happened.
- The summary should describe the conversation, not give recommendations.

Allowed customer_intent values:
- ORDER_TRACKING
- ORDER_CANCELLATION
- RETURN_REQUEST
- DAMAGED_PRODUCT
- DELIVERY_POLICY
- COD_POLICY
- GENERAL_SUPPORT
- OTHER

Allowed resolution_status values:
- RESOLVED
- PARTIALLY_RESOLVED
- UNRESOLVED
- INFORMATION_PROVIDED

Return ONLY valid JSON in exactly this structure:

{{
  "customer_intent": "...",
  "order_id": "ORD-101 or ORD-102 or ORD-103 or null",
  "resolution_status": "...",
  "call_summary": "..."
}}

Conversation:

{conversation}
"""

    try:
        response = client.models.generate_content(
            model="gemini-3.5-flash-lite",
            contents=prompt,
            config={
                "response_mime_type": "application/json"
            }
        )

        print("SUMMARY GEMINI RESPONSE:")
        print(response.text)

        return json.loads(response.text)

    except Exception as e:
        print("SUMMARY GENERATION ERROR:")
        print(repr(e))
        raise
