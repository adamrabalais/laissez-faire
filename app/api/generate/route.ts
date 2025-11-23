import { NextResponse } from 'next/server';

const SYSTEM_PROMPT = `
You are a meal planning API. You do not invent recipes. You find REAL, existing recipes from reputable websites (like AllRecipes, FoodNetwork, SeriousEats, BonAppetit, NYT Cooking, etc).
Structure the response as an array of recipe objects.
Each object must have: 
- id (number)
- title (string: The exact title from the website)
- description (short string)
- cuisine (string)
- kidFriendly (boolean)
- rating (number, between 3.0 and 5.0)
- reviewCount (number)
- ingredients (array of objects: {name, amount (number), unit, category, emoji (string)})
- instructions (array of strings - summary of steps)
- servings (number, default 4)
- sourceUrl (string: The ACTUAL URL to the specific recipe on the web. Do NOT use a search query URL.)

Categories must be one of: Produce, Meat, Pantry, Dairy, Bakery, Spices, Refrigerated.
Minimize food waste by reusing ingredients across recipes where logical.
`;

// Helper to scrape the Open Graph image from a URL
async function fetchOgImage(url: string): Promise<string | null> {
  if (!url || url.includes('google.com')) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout
    
    const res = await fetch(url, { 
        signal: controller.signal,
        headers: { 'User-Agent': 'Laissez-faire-Bot/1.0' } 
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) return null;
    const html = await res.text();
    
    // Simple regex to find <meta property="og:image" content="...">
    const match = html.match(/<meta property="og:image" content="([^"]+)"/i);
    return match ? match[1] : null;
  } catch (e) {
    return null; // Fail silently
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
  Return ONLY the JSON array. Ensure 'sourceUrl' is a real, valid link.`;

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
      console.error("Error Details:", JSON.stringify(data, null, 2));
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
        console.error("JSON Parse Error:", text);
        return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 500 });
    }

    // POST-PROCESSING: Fetch Real Images (with Unsplash Fallback)
    console.log("Fetching images...");
    const enhancedRecipes = await Promise.all(recipes.map(async (recipe: any) => {
        let imageUrl = null;

        // 1. Try to scrape the REAL image from the source URL
        if (recipe.sourceUrl) {
            imageUrl = await fetchOgImage(recipe.sourceUrl);
        }

        // 2. If scrape failed, fallback to Unsplash
        if (!imageUrl && unsplashAccessKey) {
            try {
                const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(recipe.title)}&per_page=1&orientation=landscape&client_id=${unsplashAccessKey}`;
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
    console.error("Server Error:", error);
    return NextResponse.json({ error: "Failed to generate recipes" }, { status: 500 });
  }
}
