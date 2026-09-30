import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

from app.agent.tools import get_order_details

load_dotenv(override=True)

gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

order_tool = types.FunctionDeclaration(
    name="get_order_details",
    description="Get details for an Aura Skincare customer order.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "order_id": types.Schema(
                type="STRING",
                description="The customer's order ID, for example ORD-101.",
            )
        },
        required=["order_id"],
    ),
)

tool = types.Tool(
    function_declarations=[order_tool]
)

chat = gemini_client.chats.create(
    model="gemini-3.5-flash-lite",
    config=types.GenerateContentConfig(
        system_instruction="""
You are Aria, a friendly and concise Aura Skincare customer support agent.

When a customer asks about an order, ALWAYS use the get_order_details tool.
Never invent order information.

Keep your response short and natural because you are a voice agent.
""",
        tools=[tool],
    ),
)

response = chat.send_message(
    "Hi, where is my order ORD-101?"
)

if response.function_calls:
    for function_call in response.function_calls:
        if function_call.name == "get_order_details":
            order_id = function_call.args["order_id"]

            result = get_order_details(order_id)

            print("Tool called:", function_call.name)
            print("Tool result:", result)

            response = chat.send_message(
                types.Part.from_function_response(
                    name="get_order_details",
                    response=result,
                )
            )

print("\nAria:")
print(response.text)