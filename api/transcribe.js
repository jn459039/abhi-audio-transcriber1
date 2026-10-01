import OpenAI from "openai";
import formidable from "formidable";
import fs from "node:fs";

export const config = {
  api: {
    bodyParser: false
  }
};

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

  const form = formidable({
    maxFileSize: 25 * 1024 * 1024,
    keepExtensions: true
  });

  let file;

  try {
    const [, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    file = Array.isArray(files.file)
      ? files.file[0]
      : files.file;

    if (!file) {
      return res.status(400).json({
        error: "Please attach an audio file."
      });
    }

    const client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1"
    });

    const result = await client.audio.transcriptions.create({
      file: fs.createReadStream(file.filepath),
      model: "whisper-large-v3-turbo"
    });

    return res.status(200).json({
      text: result.text
    });

  } catch (error) {
    console.error("Groq transcription error:", error);

    return res.status(500).json({
      error: error.message || "Transcription failed."
    });

  } finally {
    if (file?.filepath) {
      fs.promises.unlink(file.filepath).catch(() => {});
    }
  }
}
