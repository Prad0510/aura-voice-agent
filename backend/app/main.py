import os
import datetime

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from app.agent.tools import get_order_details
from app.agent.prompt import ARIA_SYSTEM_PROMPT
from pydantic import BaseModel
from app.services.summary import generate_call_summary


app = FastAPI(title="Aura Voice CX Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

load_dotenv()


gemini_client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)

class SummaryRequest(BaseModel):
    transcript: list


@app.post("/api/summarize")
async def summarize_call(request: SummaryRequest):
    return generate_call_summary(request.transcript)

@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/orders/{order_id}")
def get_order(order_id: str):
    return get_order_details(order_id)


@app.get("/test-ai")
def test_ai():
    response = gemini_client.models.generate_content(
        model="gemini-3.5-flash-lite",
        contents="Hello Aria, introduce yourself in one short sentence."
    )

    return {
        "response": response.output_text
    }
    
@app.get("/api/live-token")
def get_live_token():
    now = datetime.datetime.now(datetime.timezone.utc)

    token = gemini_client.auth_tokens.create(
        config={
            "uses": 1,
            "expire_time": now + datetime.timedelta(minutes=30),
            "new_session_expire_time": now + datetime.timedelta(minutes=1),
        }
    )

    return {
        "token": token.name
    }