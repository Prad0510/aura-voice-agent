# Aura Voice CX Agent

A browser-based AI voice support agent for Aura Skincare.

The idea was to build something that can handle common customer support questions through a voice conversation instead of making the user type everything manually. The agent, **Aria**, can check order details, explain delivery/return policies, and handle basic order-related queries.

## What it can do

* Talk to the customer using voice
* Understand what the customer is asking
* Check order details using an order lookup tool
* Answer questions about:

  * Order status
  * Delivery
  * Returns
  * Damaged/defective products
  * Cancellation eligibility
  * Cash On Delivery
* Keep context during the conversation
* Show the conversation transcript after the call
* Generate a structured call summary after the call

The agent is also instructed not to make up information or claim that it performed an action when the system does not actually support that action.

## How it works

The basic flow is:

```text
Customer
   ↓
React/Vite Frontend
   ↓
Gemini Live API
   ↓
Aria (AI Voice Agent)
   ↓
get_order_details()
   ↓
FastAPI Backend
   ↓
Order Data
```

After the call:

```text
Conversation Transcript
        ↓
Gemini
        ↓
Structured Call Summary
        ↓
Frontend
```

The frontend handles the voice interaction and UI, while the FastAPI backend handles the order tool and call-summary generation.

## Tech Stack

**Frontend**

* React
* Vite
* Web Audio API

**Backend**

* Python
* FastAPI
* Pydantic

**AI**

* Google Gemini Live API
* Gemini for call summarization

**Deployment**

* Vercel — frontend
* Render — backend

## Sample Orders

The demo currently has three sample orders:

* **ORD-101** — Vitamin C Serum 30ml — Out for Delivery
* **ORD-102** — Hydrating Sunscreen SPF 50 — Delivered
* **ORD-103** — Green Tea Face Wash + Toner — Processing

These can be used directly from the UI to test different conversations.

## Important guardrails

I wanted the agent to avoid sounding confident when it cannot actually perform an action.

For example, the agent can tell the customer that an order is eligible for cancellation, but it does not claim that the cancellation was completed because there is no cancellation API/tool in the current system.

The same approach is used for things like refunds, exchanges, delivery changes and other actions that are outside the available tools.

## Running locally

### Backend

```bash
cd backend

python -m venv .venv
```

Activate the environment and install dependencies:

```bash
pip install -r requirements.txt
```

Create a `.env` file:

```env
GEMINI_API_KEY=your_gemini_api_key
```

Start the backend:

```bash
uvicorn app.main:app --reload
```

The backend will run on:

```text
http://127.0.0.1:8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend can then be opened in the browser.

For a deployed frontend, the backend URL is provided through:

```env
VITE_API_BASE_URL=https://your-backend-url
```

## Hardest part

## Hardest part

## Hardest part

The hardest part was getting all the different parts of the voice agent to work together reliably.

One issue I faced was in `App.jsx`, where the frontend was initially pointing to the local backend URL. This worked during local development but caused problems after deploying the frontend to Vercel because the deployed app could not access `127.0.0.1` on my computer. I fixed this by making the backend URL configurable through an environment variable and connecting the deployed frontend to the Render backend.

Another challenge was the call summary. After the conversation ends, the transcript is sent to Gemini to generate a structured summary with the customer's intent, order ID, resolution status and a short summary. I had to make sure the summary was based only on the actual conversation and did not assume that an action was completed when it wasn't.

I also had to keep the voice conversation working while handling order lookups and transcripts at the same time.

Finally, I made sure Aria does not pretend to perform actions that the backend cannot actually perform. For example, if a customer asks to cancel an order, the agent can check the order status and explain whether cancellation is allowed, but it should not say that the order has been cancelled without an actual cancellation tool.

## What I would improve with one more week

With more time, I would move the order data from the current static dataset to a proper database and add real backend tools for actions such as cancellation, refund requests and support-ticket creation.

I would also add authentication, better error handling and more extensive testing for different voice conversations.

For the voice experience, I would spend more time improving interruption handling, supporting different languages/accent and making the conversation feel even more natural.

## Scaling to 1,000 calls/day

For 1,000 calls per day, I would separate the voice layer from the backend API and make the backend stateless so it can scale horizontally.

I would also:

* Move order data to PostgreSQL
* Add proper connection pooling
* Use Redis for frequently accessed data/caching where useful
* Add request rate limiting
* Add logging and monitoring
* Queue non-real-time tasks such as call-summary generation
* Store transcripts and summaries separately from the live voice session
* Add retries and timeouts around external AI/API calls

The main goal would be to keep the live voice path lightweight while moving heavier post-call processing into background workers.

## Demo

Live application:

**https://aura-voice-agent-three.vercel.app/**

A simple demo flow is:

1. Start a call
2. Ask Aria about ORD-101
3. Ask a follow-up question about delivery
4. Ask about another order
5. End the call
6. View the transcript and generated call summary
