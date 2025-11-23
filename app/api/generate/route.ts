import { NextResponse } from 'next/server';

const SYSTEM_PROMPT = `
You are a meal planning API. You find REAL, existing recipes.
Structure the response as an array of recipe objects.
Each object must have: 
- id (number)
- title (string)
- description (short string)
- cuisine (string)
- kidFriendly (boolean)
- rating (number, 3.0-5.0)
- reviewCount (number)
- imageSearchQuery (string: 2-4 keywords to find a perfect stock photo of this finished dish on Unsplash. e.g. "grilled chicken souvlaki plate")
- ingredients (array of objects: {name, amount (number), unit, category, emoji (string)})
- instructions (array of strings)
- servings (number, default 4)
- sourceUrl (string: A real URL if you are 100% sure it exists, otherwise leave empty string.)

Categories must be one of: Produce, Meat, Pantry, Dairy, Bakery, Spices, Refrigerated.
Minimize food waste by reusing ingredients across recipes where logical.
`;

// Helper to scrape the Open Graph image from a URL
async function fetchOgImage(url: string): Promise<string | null> {
  if (!url || url.includes('google.com')) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); 
    
    const res = await fetch(url, { 
        signal: controller.signal,
        headers: { 'User-Agent': 'Laissez-faire-Bot/1.0' } 
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) return null;
    const html = await res.text();
    
    const match = html.match(/<meta property="og:image" content="([^"]+)"/i);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const { count, people, diet, kidFriendly, priority } = body;

  let priorityInstruction = "Balance cost, ease, and flavor."; 
  if (priority === 'Cheaper Ingredients') {
    priorityInstruction = "Prioritize recipes known for being budget-friendly.";
  } else if (priority === 'Fewer Ingredients') {
    priorityInstruction = "Prioritize recipes with short ingredient lists (5-7 items).";
  } else if (priority === 'Fancier Meals') {
    priorityInstruction = "Prioritize highly-rated gourmet recipes.";
  }

  const userPrompt = `Find ${count} distinct ${diet} dinner recipes for ${people} people. 
  ${kidFriendly ? "Select recipes that are generally considered kid-friendly." : ""}
  ${priorityInstruction}
  Return ONLY the JSON array.`;

  const googleApiKey = (process.env.GOOGLE_API_KEY || '').trim();
  const unsplashAccessKey = (process.env.UNSPLASH_ACCESS_KEY || '').trim();

  // USE GEMINI 2.5 FLASH
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleApiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SYSTEM_PROMPT + "\n" + userPrompt }] }]
      })
    });

    const data = await response.json();

    if (!data.candidates) {
      console.error("--- GENERATION FAILED ---");
      return NextResponse.json({ 
        error: "API Error", 
        details: data.error?.message || "No candidates returned." 
      }, { status: 500 });
    }

    let text = data.candidates[0].content.parts[0].text;
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let recipes = [];
    try {
        recipes = JSON.parse(text);
    } catch (parseError) {
        return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 500 });
    }

    // POST-PROCESSING
    const enhancedRecipes = await Promise.all(recipes.map(async (recipe: any) => {
        let imageUrl = null;

        // 1. Try real image from source
        if (recipe.sourceUrl && recipe.sourceUrl.startsWith('http')) {
            imageUrl = await fetchOgImage(recipe.sourceUrl);
        }

        // 2. Fallback to Unsplash with optimized query
        if (!imageUrl && unsplashAccessKey) {
            try {
                // Use the specific search query from AI, or title as fallback
                const query = recipe.imageSearchQuery || recipe.title;
                const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape&client_id=${unsplashAccessKey}`;
                const imgRes = await fetch(unsplashUrl);
                const imgData = await imgRes.json();
                imageUrl = imgData.results?.[0]?.urls?.regular || null;
            } catch (e) {
                console.error(`Unsplash failed for ${recipe.title}`);
            }
        }

        return { ...recipe, imageUrl };
    }));

    return NextResponse.json(enhancedRecipes);
    
  } catch (error) {
    return NextResponse.json({ error: "Failed to generate recipes" }, { status: 500 });
  }
}
