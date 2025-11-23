import { NextResponse } from 'next/server';

const SYSTEM_PROMPT = `
You are a meal planning API. You must output valid JSON only. 
Do not speak in sentences. 
You are generating recipes for the "Laissez-faire" app.
Structure the response as an array of recipe objects.
Each object must have: 
- id (number)
- title (string)
- description (short string)
- cuisine (string)
- kidFriendly (boolean)
- ingredients (array of objects: {name, amount (number), unit, category})
- instructions (array of strings)
- servings (number, default 4)
- sourceUrl (search query url)

Categories must be one of: Produce, Meat, Pantry, Dairy, Bakery, Spices, Refrigerated.
Minimize food waste by reusing ingredients across recipes where logical.
`;

export async function POST(request: Request) {
  // 1. Get the user's request
  const { count, people, diet, kidFriendly } = await request.json();

  // 2. Construct the specific prompt for this user
  const userPrompt = `Generate ${count} distinct ${diet} dinner recipes for ${people} people. 
  ${kidFriendly ? "Make them kid-friendly (simple flavors, no heavy spice)." : ""}
  Return ONLY the JSON array.`;

  // 3. Call Google Gemini API (using raw fetch to keep it simple)
  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SYSTEM_PROMPT + "\n" + userPrompt }] }]
      })
    });

    const data = await response.json();
    
    // 4. Clean up the response text to ensure it is valid JSON
    let text = data.candidates[0].content.parts[0].text;
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const recipes = JSON.parse(text);

    return NextResponse.json(recipes);
    
  } catch (error) {
    console.error("AI Error:", error);
    return NextResponse.json({ error: "Failed to generate recipes" }, { status: 500 });
  }
}
