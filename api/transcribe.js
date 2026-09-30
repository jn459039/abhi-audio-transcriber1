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

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "Transcription service is not configured."
    });
  }

  const form = formidable({
    maxFileSize: 25 * 1024 * 1024,
    keepExtensions: true
  });

  try {
    const [, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const file = Array.isArray(files.file)
      ? files.file[0]
      : files.file;

    if (!file) {
      return res.status(400).json({
        error: "Please attach an audio file."
      });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const result =
      await client.audio.transcriptions.create({
        file: fs.createReadStream(file.filepath),
        model: "whisper-1"
      });

    return res.status(200).json({
      text: result.text
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Transcription failed."
    });
  }
}
