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
  const body = await request.json();
  const { count, people, diet, kidFriendly } = body;

  const userPrompt = `Generate ${count} distinct ${diet} dinner recipes for ${people} people. 
  ${kidFriendly ? "Make them kid-friendly (simple flavors, no heavy spice)." : ""}
  Return ONLY the JSON array.`;

  const apiKey = process.env.GOOGLE_API_KEY || '';
  
  // UPDATED: Changed 'v1beta' to 'v1' because gemini-pro lives in v1.
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SYSTEM_PROMPT + "\n" + userPrompt }] }]
      })
    });

    const data = await response.json();

    // --- SAFETY CHECK ---
    if (!data.candidates) {
      console.error("Google API Error Details:", JSON.stringify(data, null, 2));
      return NextResponse.json({ 
        error: "API Error", 
        details: data.error?.message || "No candidates returned" 
      }, { status: 500 });
    }

    let text = data.candidates[0].content.parts[0].text;
    
    // Clean up markdown formatting
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // Parse JSON safely
    let recipes;
    try {
        recipes = JSON.parse(text);
    } catch (parseError) {
        console.error("JSON Parse Error:", text);
        return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 500 });
    }

    return NextResponse.json(recipes);
    
  } catch (error) {
    console.error("Server Error:", error);
    return NextResponse.json({ error: "Failed to generate recipes" }, { status: 500 });
  }
}
