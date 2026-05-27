export default async function handler(req, res) {
  const gasUrl = req.query.gasUrl || (req.body && req.body.gasUrl);
  if (!gasUrl) return res.status(400).json({ error: "gasUrl is required" });

  try {
    if (req.method === "GET") {
      const token = req.query.token || "";
      const r = await fetch(`${gasUrl}?token=${encodeURIComponent(token)}`);
      const text = await r.text();
      try { return res.status(200).json(JSON.parse(text)); }
      catch (e) { return res.status(200).send(text); }
    }
    if (req.method === "POST") {
      const { token, data } = req.body;
      const r = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ token: token || "", data }),
      });
      const text = await r.text();
      try { return res.status(200).json(JSON.parse(text)); }
      catch (e) { return res.status(200).send(text); }
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
