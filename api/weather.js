export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const city = req.query.city || "Seoul";
  const apiKey = process.env.WEATHER_API_KEY;

  if (!apiKey) {
    return res
      .status(500)
      .json({
        error: "WEATHER_API_KEY is not configured in environment variables.",
      });
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("Weather API Route Error:", error);
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
}
