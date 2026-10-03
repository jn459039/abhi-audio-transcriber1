import OpenAI, { toFile } from "openai";
import { get } from "@vercel/blob";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({
      error: "Groq API key is not configured."
    });
  }

  try {
    const { url, filename } = req.body || {};

    if (!url || !filename) {
      return res.status(400).json({
        error: "Missing audio file information."
      });
    }

    // Fetch audio from Vercel Blob
    const blob = await get(url, {
      access: "private"
    });

    if (!blob || blob.statusCode !== 200) {
      return res.status(404).json({
        error: "Audio file not found in storage."
      });
    }

    const audioBuffer = await new Response(
      blob.stream
    ).arrayBuffer();

    const audioFile = await toFile(
      audioBuffer,
      filename,
      {
        type: blob.blob.contentType || "audio/mpeg"
      }
    );

    const client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1"
    });

    // STEP 1: Transcribe the complete audio
    const transcription =
      await client.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-large-v3-turbo"
      });

    const transcript = transcription.text;

    if (!transcript || !transcript.trim()) {
      return res.status(422).json({
        error: "No speech could be detected in the audio."
      });
    }

    // STEP 2: Generate call audit report
    const auditResponse =
      await client.chat.completions.create({
        model: "openai/gpt-oss-120b",
        temperature: 0.2,
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content: `
You are an expert airline customer service call auditor.

Analyze the supplied call transcript and produce
a factual, concise audit report.

Do not invent information.
If information is missing, write "Not specified".

Identify the airline only when supported by the conversation.
Distinguish the customer's request from the agent's response.
Clearly state whether the issue was resolved.

Return valid JSON with exactly these fields:

{
  "airline": "",
  "customer_intent": "",
  "call_summary": "",
  "agent_response": "",
  "resolution": "",
  "pending_action": "",
  "call_outcome": ""
}

For call_outcome, use only:
Resolved, Partially Resolved, Unresolved,
or Unable to Determine.

Write the report in clear professional English.
`
          },
          {
            role: "user",
            content: `
Analyze this airline customer service call.

TRANSCRIPT:
${transcript}
`
          }
        ]
      });

    // STEP 3: Parse audit JSON
    const auditText =
      auditResponse.choices[0]?.message?.content || "{}";

    let audit;

    try {
      audit = JSON.parse(auditText);
    } catch (parseError) {
      console.error("Audit JSON parsing error:", parseError);

      audit = {
        airline: "Not specified",
        customer_intent: "Unable to generate",
        call_summary: auditText,
        agent_response: "Unable to determine",
        resolution: "Unable to determine",
        pending_action: "Not specified",
        call_outcome: "Unable to Determine"
      };
    }

    // STEP 4: Return both transcript and audit
    return res.status(200).json({
      success: true,
      filename,
      text: transcript,
      audit
    });

  } catch (error) {
    console.error("Call processing error:", error);

    return res.status(500).json({
      error: error.message || "Call processing failed."
    });
  }
}
