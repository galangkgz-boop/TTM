import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const request = req.body?.request;

    if (!request) {
      res.status(400).send("Missing request");
      return;
    }

    const privateKey = process.env.QZ_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!privateKey) {
      res.status(500).send("QZ_PRIVATE_KEY is missing");
      return;
    }

    const signer = crypto.createSign("RSA-SHA512");
    signer.update(request, "utf8");
    signer.end();

    const signature = signer.sign(privateKey, "base64");

    res.setHeader("Content-Type", "text/plain");
    res.status(200).send(signature);
  } catch (error) {
    console.error("QZ SIGN ERROR:", error);
    res.status(500).send(error?.message || "QZ sign error");
  }
}