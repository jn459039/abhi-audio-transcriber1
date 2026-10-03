import OpenAI, { toFile } from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST only"
    });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({
      error: "Groq API key is not configured."
    });
  }

  try {
    const { url } = req.body || {};

    if (!url) {
      return res.status(400).json({
        error: "Audio URL is required."
      });
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({
        error: "Invalid audio URL."
      });
    }

    if (parsedUrl.protocol !== "https:") {
      return res.status(400).json({
        error: "Only HTTPS audio links are supported."
      });
    }

    // Download audio from direct URL
    const audioResponse = await fetch(url, {
      signal: AbortSignal.timeout(120000)
    });

    if (!audioResponse.ok) {
      return res.status(400).json({
        error: "Could not download audio from the supplied link."
      });
    }

    const contentType =
      audioResponse.headers.get("content-type") || "";

    if (
      contentType &&
      !contentType.startsWith("audio/") &&
      !contentType.startsWith("video/") &&
      !contentType.includes("octet-stream")
    ) {
      return res.status(400).json({
        error: "The URL does not appear to point directly to an audio file."
      });
    }

    const audioBuffer = await audioResponse.arrayBuffer();

    if (audioBuffer.byteLength === 0) {
      return res.status(400).json({
        error: "The audio file is empty."
      });
    }

    // Groq Whisper file limit
    if (audioBuffer.byteLength > 25 * 1024 * 1024) {
      return res.status(413).json({
        error: "Audio exceeds the 25 MB limit. Please use a smaller file."
      });
    }

    const pathname = parsedUrl.pathname;

    let filename =
      pathname.split("/").pop() || "audio.mp3";

    if (
      !/\.(mp3|wav|m4a|ogg|webm|mp4|mpeg|mpga)$/i.test(filename)
    ) {
      filename = "audio.mp3";
    }

    const audioFile = await toFile(
      audioBuffer,
      filename,
      {
        type: contentType || "audio/mpeg"
      }
    );

    const client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1"
    });

    // Step 1: Full transcription
    const transcription =
      await client.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-large-v3-turbo"
      });

    const transcript = transcription.text;

    if (!transcript || !transcript.trim()) {
      return res.status(422).json({
        error: "No speech could be detected."
      });
    }

    // Step 2: Generate airline call audit
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

    let audit;

    try {
      audit = JSON.parse(
        auditResponse.choices[0]?.message?.content || "{}"
      );
    } catch (error) {
      console.error("Audit parsing error:", error);

      audit = {
        airline: "Not specified",
        customer_intent: "Unable to generate",
        call_summary: "Audit generation failed.",
        agent_response: "Unable to determine",
        resolution: "Unable to determine",
        pending_action: "Not specified",
        call_outcome: "Unable to Determine"
      };
    }

    return res.status(200).json({
      success: true,
      filename,
      text: transcript,
      audit
    });

  } catch (error) {
    console.error("Direct link processing error:", error);

    return res.status(500).json({
      error: error.message || "Audio processing failed."
    });
  }
}
