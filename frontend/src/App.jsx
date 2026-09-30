import { useRef, useState } from "react";
import { GoogleGenAI, Modality } from "@google/genai";
import "./App.css";

function App() {
  const [status, setStatus] = useState("Ready");
  const [transcript, setTranscript] = useState([]);
  const [summary, setSummary] = useState(null);

  const sessionRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const microphoneRef = useRef(null);
  const nextPlayTimeRef = useRef(0);

  // Add transcript message.
  // Consecutive messages from the same speaker are merged
  // because Gemini sends speech transcription in small chunks.
  const addTranscript = (speaker, text) => {
    if (!text?.trim()) return;

    const cleanText = text.trim();

    setTranscript((prev) => {
      if (
        prev.length > 0 &&
        prev[prev.length - 1].speaker === speaker
      ) {
        const updated = [...prev];

        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          text: `${updated[updated.length - 1].text} ${cleanText}`
            .replace(/\s+/g, " ")
            .trim(),
          time: new Date().toLocaleTimeString(),
        };

        return updated;
      }

      return [
        ...prev,
        {
          speaker,
          text: cleanText,
          time: new Date().toLocaleTimeString(),
        },
      ];
    });
  };

  // Convert Float32 microphone samples to 16-bit PCM
  const floatTo16BitPCM = (float32Array) => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < float32Array.length; i++) {
      let sample = Math.max(-1, Math.min(1, float32Array[i]));

      view.setInt16(
        i * 2,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true
      );
    }

    return new Uint8Array(buffer);
  };

  const arrayBufferToBase64 = (buffer) => {
    let binary = "";

    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  };

  const base64ToUint8Array = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  };

  const playAudio = async (base64Audio) => {
    const bytes = base64ToUint8Array(base64Audio);

    // Gemini Live audio output is 16-bit PCM, 24 kHz
    const int16 = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / 2
    );

    const audioContext = audioContextRef.current;

    if (!audioContext) return;

    const audioBuffer = audioContext.createBuffer(
      1,
      int16.length,
      24000
    );

    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < int16.length; i++) {
      channelData[i] = int16[i] / 32768;
    }

    const source = audioContext.createBufferSource();

    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    const startTime = Math.max(
      audioContext.currentTime,
      nextPlayTimeRef.current
    );

    source.start(startTime);

    nextPlayTimeRef.current =
      startTime + audioBuffer.duration;
  };

  const startCall = async () => {
    try {
      setTranscript([]);
      setSummary(null);
      setStatus("Connecting...");

      // 1. Get ephemeral token from FastAPI
      const tokenResponse = await fetch(
        "http://127.0.0.1:8000/api/live-token"
      );

      const tokenData = await tokenResponse.json();

      // 2. Create Gemini client using temporary token
      const ai = new GoogleGenAI({
        apiKey: tokenData.token,
        httpOptions: {
          apiVersion: "v1alpha",
        },
      });

      // 3. Create audio context
      const audioContext = new AudioContext({
        sampleRate: 16000,
      });

      audioContextRef.current = audioContext;

      await audioContext.resume();

      // 4. Ask browser for microphone
      const microphoneStream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

      microphoneRef.current = microphoneStream;

      // 5. Connect to Gemini Live
      const liveSession = await ai.live.connect({
        model: "gemini-3.8-live",

        config: {
          responseModalities: [Modality.AUDIO],

          systemInstruction: {
            parts: [
              {
                text: `
You are Aria, the AI customer support specialist for Aura Skincare.

You are friendly, professional, concise and natural.
Speak like an Indian customer support representative.

Help customers with:
- Orders
- Delivery
- Returns
- Cancellations

Aura Skincare policies:

Delivery:
- Free delivery for orders above ₹499.
- Orders below ₹499 have a ₹50 delivery fee.
- Delivery normally takes 3–5 business days.

Returns:
- Returns are accepted within 7 days.
- Product must be unopened, unused and in original packaging.

Damaged or defective products:
- Must be reported within 48 hours.
- Customer should provide photos.

Cancellation:
- Cancellation is allowed only while an order is Processing.
- Shipped or Out for Delivery orders cannot be cancelled.
- Customers can refuse delivery instead.

COD:
- Cash on Delivery is available up to ₹2500.
- Customers can pay by cash or UPI at the doorstep.


IMPORTANT ORDER LOOKUP RULES:

- When the customer asks about a specific order, use the get_order_details tool.
- Always check the order details before confirming an order's status.
- Always check the order details before confirming whether an order can be cancelled.
- Never ask the customer to tell you the order status if the order ID is available.
- Never invent order information.
- Never assume an order's status.
- If the customer says "order 103", interpret it as "ORD-103".
- If the customer says "order 101", interpret it as "ORD-101".
- If the customer says "order 102", interpret it as "ORD-102".


IMPORTANT SPEECH UNDERSTANDING RULES:

- Treat "cancel", "cancellation", "cancel my order", and similar phrases as ORDER CANCELLATION requests.
- If the user's speech sounds unclear or a word may have been misheard, do not confidently interpret it as an unrelated topic.
- If you hear something like "cancer" but the surrounding conversation is about an order, ask:
  "Sorry, did you mean you want to cancel your order?"
- Never discuss unrelated medical topics merely because a word sounds similar to "cancer".
- When the user's intent is ambiguous, ask a short clarification question instead of guessing.


ORDER CANCELLATION:

- Orders with status "Processing" are eligible for cancellation.
- Orders that are "Out for Delivery" or already shipped cannot be cancelled.
- For shipped/out-for-delivery orders, explain that the customer can refuse the delivery instead.
- For delivered orders, cancellation is not applicable.
- Always check the order details before confirming cancellation eligibility.

IMPORTANT CANCELLATION ACTION RULE:

- The current system can ONLY retrieve order information.
- There is NO cancellation-execution tool.
- You can confirm whether an order is eligible for cancellation.
- You CANNOT actually cancel an order.
- NEVER claim that an order has been cancelled.
- NEVER say that you successfully cancelled an order.
- NEVER claim that a cancellation request was submitted.
- NEVER claim that a confirmation email was sent.
- If the customer asks you to cancel an eligible order, explain that the order is eligible for cancellation but that you cannot perform the cancellation directly in this system.
- Do not ask "Would you like me to proceed with the cancellation?" because you cannot actually perform that action.

For example:

Customer:
"Can I cancel order 103?"

Correct response:
"Your order ORD-103 is currently processing, so it is eligible for cancellation. I can confirm the eligibility, but I can't complete the cancellation directly."

If the customer says:
"Yes, please cancel it."

Correct response:
"I can confirm that ORD-103 is eligible for cancellation, but I can't complete the cancellation from this system. Please contact Aura Skincare support to complete it."


IMPORTANT GENERAL RULES:

- Never invent order information.
- Never invent policies.
- Never claim an action was completed unless you actually have a tool that performed that action.
- If information is unclear, say that you are not certain.
- Keep responses concise and conversational.

IMPORTANT ACTION / ESCALATION GUARDRAILS:

- The system currently has ONLY one tool: get_order_details.
- The tool can ONLY retrieve order information.
- You cannot contact couriers.
- You cannot raise disputes.
- You cannot create support tickets.
- You cannot escalate cases.
- You cannot send emails or notifications.
- You cannot promise future updates.
- You cannot monitor an order after the conversation ends.
- You cannot claim that you contacted another team or service.
- You cannot claim that an investigation was started.
- You cannot claim that a dispute was raised.
- You cannot claim that an issue was escalated.
- You cannot claim that someone will contact the customer later.

If a customer reports a problem that requires an action the system cannot perform:
1. Acknowledge the customer's concern.
2. Provide any information available from the order lookup.
3. Clearly explain that you cannot perform that action from this system.
4. Suggest the customer contact Aura Skincare support for further assistance.
5. Do not invent a support phone number, email address, ticket number, escalation process, or expected response time.

For example, if an order is marked Delivered but the customer says they did not receive it:

Correct:
"Your order ORD-102 is showing as delivered 14 days ago through Delhivery, with tracking ID DL-441029. I can't raise a courier dispute or investigate the delivery directly from this system. Please contact Aura Skincare support with your order and tracking details for further assistance."

Incorrect:
"I'll raise a dispute with the courier."
"I'll escalate this to our delivery team."
"I'll keep monitoring it."
"I'll update you once we receive a response."

STRICT RESPONSE GUARDRAILS:

- Use ONLY the Aura Skincare policies, order information, and capabilities
  explicitly provided in this system instruction and through available tools.
- Never invent policies, actions, options, processes, or services.
- Do not suggest "refreeze delivery", rescheduling, delivery holds, refunds,
  disputes, tickets, escalations, callbacks, notifications, or other actions
  unless the system explicitly provides a capability for them.
- The only available order tool is get_order_details.
- You cannot contact couriers, modify orders, delay deliveries, process refunds,
  create tickets, raise disputes, send notifications, or monitor an issue after
  the call.
- If the customer requests an unavailable action, clearly state that you cannot
  perform that action and provide only information that is actually available.

LANGUAGE CONSISTENCY:

- Respond in the same language as the customer's current conversation.
- Do not switch languages merely because speech recognition detects a phrase
  from another language.
- If the customer explicitly asks to continue in another language, follow that
  request.
- When the language is unclear, continue in English.

                `,
              },
            ],
          },

          inputAudioTranscription: {},
          outputAudioTranscription: {},

          tools: [
            {
              functionDeclarations: [
                {
                  name: "get_order_details",

                  description:
                    "Get details of a customer's order by order ID. Use this tool whenever the customer asks about an order, including delivery status, cancellation eligibility, or order details.",

                  parameters: {
                    type: "object",

                    properties: {
                      order_id: {
                        type: "string",

                        description:
                          "The Aura Skincare order ID, such as ORD-101, ORD-102, or ORD-103.",
                      },
                    },

                    required: ["order_id"],
                  },
                },
              ],
            },
          ],
        },

        callbacks: {
          onopen: () => {
            console.log("Gemini Live connected");
            setStatus("Listening");
          },

          onmessage: async (message) => {
            console.log("Gemini message:", message);

            /*
             * FUNCTION / TOOL CALL
             *
             * Gemini asks our application to retrieve
             * order information.
             */
            if (message.toolCall) {
              console.log(
                "Tool call received:",
                message.toolCall
              );

              const functionResponses = [];

              for (const functionCall of message.toolCall.functionCalls) {
                console.log(
                  "Function:",
                  functionCall.name
                );

                if (
                  functionCall.name === "get_order_details"
                ) {
                  const orderId =
                    functionCall.args?.order_id;

                  console.log(
                    "Looking up order:",
                    orderId
                  );

                  try {
                    const response = await fetch(
                      `http://127.0.0.1:8000/orders/${orderId}`
                    );

                    const orderData =
                      await response.json();

                    console.log(
                      "Order data:",
                      orderData
                    );

                    functionResponses.push({
                      id: functionCall.id,

                      name: functionCall.name,

                      response: {
                        result: orderData,
                      },
                    });
                  } catch (error) {
                    console.error(
                      "Order lookup failed:",
                      error
                    );

                    functionResponses.push({
                      id: functionCall.id,

                      name: functionCall.name,

                      response: {
                        result: {
                          found: false,

                          message:
                            "Unable to retrieve order details.",
                        },
                      },
                    });
                  }
                }
              }

              /*
               * Send the tool result back to Gemini.
               *
               * Gemini can now use the real order information
               * to formulate its spoken response.
               */
              if (sessionRef.current) {
                sessionRef.current.sendToolResponse({
                  functionResponses,
                });
              }

              return;
            }
            const serverContent = message.serverContent;

            if (!serverContent) return;
// Capture user's speech transcription
if (serverContent.inputTranscription?.text) {
  console.log(
    "USER TRANSCRIPT:",
    serverContent.inputTranscription.text
  );

  addTranscript(
    "You",
    serverContent.inputTranscription.text
  );
}

            /*
             * Capture Aria's speech transcription.
             *
             * Consecutive Aria chunks are merged into
             * one readable transcript message.
             */
            if (serverContent.outputTranscription?.text) {
  console.log(
    "ARIA TRANSCRIPT:",
    serverContent.outputTranscription.text
  );

  addTranscript(
    "Aria",
    serverContent.outputTranscription.text
  );
}

            // Gemini is responding with audio
            if (serverContent.modelTurn?.parts) {
              for (const part of serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  setStatus("Speaking");

                  await playAudio(
                    part.inlineData.data
                  );
                }
              }
            }

            // Response finished
            if (serverContent.turnComplete) {
              setStatus("Listening");
            }
          },

          onerror: (error) => {
            console.error(
              "Gemini Live error:",
              error
            );

            setStatus("Error");
          },

          onclose: () => {
            console.log(
              "Gemini Live closed"
            );

            setStatus("Ready");
          },
        },
      });

      sessionRef.current = liveSession;

      // 6. Capture microphone audio
      const source =
        audioContext.createMediaStreamSource(
          microphoneStream
        );

      // ScriptProcessor is simple and sufficient
      // for this assessment
      const processor =
        audioContext.createScriptProcessor(
          4096,
          1,
          1
        );

      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        if (!sessionRef.current) return;

        const inputData =
          event.inputBuffer.getChannelData(0);

        const pcmData =
          floatTo16BitPCM(inputData);

        const base64Audio =
          arrayBufferToBase64(pcmData);

        sessionRef.current.sendRealtimeInput({
          audio: {
            data: base64Audio,

            mimeType:
              "audio/pcm;rate=16000",
          },
        });
      };

      source.connect(processor);

      // Prevent microphone audio from being
      // played directly through the speakers.
      const silentGain =
        audioContext.createGain();

      silentGain.gain.value = 0;

      processor.connect(silentGain);

      silentGain.connect(
        audioContext.destination
      );

      microphoneRef.current =
        microphoneStream;
    } catch (error) {
      console.error(error);

      setStatus("Connection failed");
    }
  };

  const generateCallSummary = async (callTranscript) => {
  if (!callTranscript || callTranscript.length === 0) {
    setSummary(null);
    return;
  }

  try {
    setSummary({
      generating: true,
    });

    const response = await fetch(
      "http://127.0.0.1:8000/api/summarize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transcript: callTranscript,
        }),
      }
    );

    if (!response.ok) {
      throw new Error("Summary generation failed");
    }

    const data = await response.json();

    console.log("Generated call summary:", data);

    setSummary(data);
  } catch (error) {
    console.error("Summary generation error:", error);

    setSummary({
      customer_intent: "UNKNOWN",
      order_id: null,
      resolution_status: "UNRESOLVED",
      call_summary:
        "Unable to generate the call summary.",
    });
  }
};



  const endCall = async () => {
    console.log("Ending call...");

    await generateCallSummary(transcript);

    if (processorRef.current) {
      processorRef.current.disconnect();

      processorRef.current = null;
    }

    if (microphoneRef.current) {
      microphoneRef.current
        .getTracks()
        .forEach((track) => track.stop());

      microphoneRef.current = null;
    }

    if (sessionRef.current) {
      sessionRef.current.close();

      sessionRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();

      audioContextRef.current = null;
    }

    nextPlayTimeRef.current = 0;

    setStatus("Ready");
  };

  return (
    <div className="app">
      <div className="card">
        <h1>Aura Skincare</h1>

        <p className="subtitle">
          AI Customer Support
        </p>

        <div
          className={`status ${status
            .toLowerCase()
            .replace(" ", "-")}`}
        >
          <span className="dot"></span>

          {status}
        </div>

        <div className="avatar">
          A
        </div>

        <h2>Hi, I'm Aria</h2>

        <p className="description">
          Your Aura Skincare support assistant.
          I can help with orders, delivery,
          returns and cancellations.
        </p>

        <button
          className="call-button"
          onClick={
            status === "Ready"
              ? startCall
              : endCall
          }
        >
          {status === "Ready"
            ? "Start Call"
            : "End Call"}
        </button>

        <div className="orders">
          <h3>Test Orders</h3>

          <div className="order">
            <strong>ORD-101</strong>

            <span>
              Out for Delivery
            </span>
          </div>

          <div className="order">
            <strong>ORD-102</strong>

            <span>
              Delivered
            </span>
          </div>

          <div className="order">
            <strong>ORD-103</strong>

            <span>
              Processing
            </span>
          </div>
          {summary && (
  <div className="summary">
    <h3>Call Summary</h3>

    <div className="summary-item">
      <strong>Customer Intent</strong>
      <span>{summary.customer_intent}</span>
    </div>

    <div className="summary-item">
      <strong>Order ID</strong>
      <span>{summary.order_id || "N/A"}</span>
    </div>

    <div className="summary-item">
      <strong>Resolution Status</strong>
      <span>{summary.resolution_status}</span>
    </div>

    <div className="summary-item">
      <strong>Call Summary</strong>
      <p>{summary.call_summary}</p>
    </div>

    <details className="json-summary">
      <summary>View JSON</summary>
      <pre>
        {JSON.stringify(summary, null, 2)}
      </pre>
    </details>
  </div>
)}

<div className="transcript-section">
  <h3>Call Transcript</h3>

  {transcript.length === 0 ? (
    <p className="empty-transcript">
      Transcript will appear here during the call.
    </p>
  ) : (
    <div className="transcript">
      {transcript.map((item, index) => (
        <div className="transcript-line" key={index}>
          <strong>{item.speaker}:</strong>
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  )}
</div>

        </div>
      </div>
    </div>
  );
}

export default App;
