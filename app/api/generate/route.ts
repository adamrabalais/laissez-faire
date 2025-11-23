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
- rating (number, between 3.0 and 5.0)
- reviewCount (number)
- ingredients (array of objects: {name, amount (number), unit, category})
- instructions (array of strings)
- servings (number, default 4)
- sourceUrl (search query url)

Categories must be one of: Produce, Meat, Pantry, Dairy, Bakery, Spices, Refrigerated.
Minimize food waste by reusing ingredients across recipes where logical.
`;

export async function POST(request: Request) {
  const body = await request.json();
  const { count, people, diet, kidFriendly, priority } = body;

  // Logic to nudge the AI based on priority
  let priorityInstruction = "Balance cost, ease, and flavor."; // Default
  if (priority === 'Cheaper Ingredients') {
    priorityInstruction = "Strictly prioritize budget-friendly ingredients (beans, rice, seasonal veggies, cheaper cuts of meat). Avoid expensive specialty items.";
  } else if (priority === 'Fewer Ingredients') {
    priorityInstruction = "Strictly prioritize recipes with short ingredient lists (aim for 5-7 main ingredients). Keep it simple.";
  } else if (priority === 'Fancier Meals') {
    priorityInstruction = "Prioritize gourmet flavors, premium ingredients, and slightly more complex techniques. Make it impressive.";
  }

  const userPrompt = `Generate ${count} distinct ${diet} dinner recipes for ${people} people. 
  ${kidFriendly ? "Make them kid-friendly (simple flavors, no heavy spice)." : ""}
  ${priorityInstruction}
  Return ONLY the JSON array.`;

  // 1. SANITIZE THE KEY
  const rawKey = process.env.GOOGLE_API_KEY || '';
  const apiKey = rawKey.trim(); 

  // 2. USE THE AVAILABLE MODEL (Gemini 2.5 Flash)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SYSTEM_PROMPT + "\n" + userPrompt }] }]
      })
    });

    const data = await response.json();

    // --- DIAGNOSTIC BLOCK ---
    if (!data.candidates) {
      console.error("--- GENERATION FAILED ---");
      console.error("Error Details:", JSON.stringify(data, null, 2));
      
      return NextResponse.json({ 
        error: "API Error", 
        details: data.error?.message || "No candidates returned. Check Vercel logs." 
      }, { status: 500 });
    }

    let text = data.candidates[0].content.parts[0].text;
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
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
